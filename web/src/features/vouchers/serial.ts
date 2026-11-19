/**
 * USB thermal receipt printers via the Web Serial API (Chrome / Edge only), ESC/POS commands.
 * Connection lives for the browser tab; once connected, voucher printing goes to the thermal printer.
 */
import type { College, Voucher } from '@/api/types';
import { dmy } from '@/lib/format';

// Minimal Web Serial typings (not in lib.dom yet).
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

function serialApi(): SerialLike | null {
  const nav = navigator as Navigator & { serial?: SerialLike };
  return nav.serial ?? null;
}

export const serialSupported = () => typeof navigator !== 'undefined' && !!serialApi();

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
const listeners = new Set<() => void>();

export const isSerialConnected = () => !!writer;

/** Subscribe to connect/disconnect changes (for useSyncExternalStore). */
export function subscribeSerial(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((l) => l());

export async function connectSerialPrinter(baudRate = 9600): Promise<void> {
  const api = serialApi();
  if (!api) throw new Error('Web Serial is not available. Use Chrome or Edge on a computer.');
  const p = await api.requestPort();
  await p.open({ baudRate });
  if (!p.writable) throw new Error('Printer port is not writable');
  port = p;
  writer = p.writable.getWriter();
  emit();
}

export async function disconnectSerialPrinter(): Promise<void> {
  try {
    writer?.releaseLock();
    await port?.close();
  } catch {
    /* already closed */
  }
  writer = null;
  port = null;
  emit();
}

export async function sendToSerial(bytes: Uint8Array): Promise<void> {
  if (!writer) throw new Error('Thermal printer is not connected');
  await writer.write(bytes);
}

// ---------------- ESC/POS ----------------

const ESC = 0x1b;
const GS = 0x1d;
const CMD = {
  init: [ESC, 0x40],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  center: [ESC, 0x61, 1],
  left: [ESC, 0x61, 0],
  normal: [ESC, 0x21, 0],
  double: [ESC, 0x21, 0x30],
  cut: [GS, 0x56, 0x41, 0x10],
};
const WIDTH = 32; // characters per line on 58mm paper

/** Thermal printers only understand plain ASCII reliably. */
function ascii(s: string): string {
  return s.replace(/₹/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\n]/g, '');
}

function wrap(text: string, width = WIDTH): string[] {
  const out: string[] = [];
  for (const para of ascii(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= width) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

class EscPos {
  private bytes: number[] = [];
  private enc = new TextEncoder();
  cmd(c: number[]) {
    this.bytes.push(...c);
    return this;
  }
  text(s: string) {
    this.bytes.push(...this.enc.encode(ascii(s)));
    return this;
  }
  line(s = '') {
    return this.text(s + '\n');
  }
  field(label: string, value: string) {
    if (!value) return this;
    wrap(`${label}: ${value}`).forEach((l) => this.line(l));
    return this;
  }
  rule() {
    return this.line('-'.repeat(WIDTH));
  }
  build() {
    return new Uint8Array(this.bytes);
  }
}

const TITLE = { debit: 'DEBIT VOUCHER', credit: 'CREDIT VOUCHER', onaccount: 'ON ACCOUNT VOUCHER' } as const;

export function buildEscPosVoucher(v: Voucher, college: College | undefined): Uint8Array {
  const p = new EscPos().cmd(CMD.init).cmd(CMD.center).cmd(CMD.boldOn);
  wrap((college?.name ?? "St. Mary's").toUpperCase()).forEach((l) => p.line(l));
  p.cmd(CMD.boldOff);
  if (college?.location) p.line(college.location);
  p.line().cmd(CMD.double).line(v.type === 'onaccount' ? 'ON ACCOUNT' : v.type.toUpperCase()).cmd(CMD.normal);
  p.line(TITLE[v.type]).cmd(CMD.left).rule();
  p.field('No', v.voucherNo).field('Date', dmy(v.date));
  if (v.type === 'credit') p.field('Credit A/c', v.head).field('Received from', v.receivedFrom);
  else p.field(v.type === 'onaccount' ? 'On Account' : 'Debit A/c', v.head).field('Paid to', v.paidTo);
  p.field('Towards', v.towards).field('Block', v.block);
  if (v.type === 'onaccount') {
    p.field('Phone', v.recipientPhone).field('Status', v.reversalDate ? `CLEAR - ${dmy(v.reversalDate)}` : 'PENDING');
  }
  p.field('Remarks', v.remarks).rule();
  p.cmd(CMD.boldOn).cmd(CMD.double).line(`Rs. ${Math.round(v.amount)}`).cmd(CMD.normal).cmd(CMD.boldOff);
  wrap(v.amtWords).forEach((l) => p.line(l));
  p.field('Mode', v.mode + (v.cheque ? ` | Ref: ${v.cheque}` : '')).rule();
  p.line().line().line(v.checkedBy ? `Checked by: ${v.checkedBy}` : 'Checked by');
  p.line().line().line(v.type === 'credit' ? 'Deposited by' : 'Signature of the Receiver');
  p.line().line().line().cmd(CMD.cut);
  return p.build();
}

export function buildEscPosTest(): Uint8Array {
  return new EscPos()
    .cmd(CMD.init)
    .cmd(CMD.center)
    .cmd(CMD.boldOn)
    .line('TEST PAGE')
    .cmd(CMD.boldOff)
    .line('Printer working correctly.')
    .line("St. Mary's Voucher System")
    .line()
    .line()
    .line()
    .cmd(CMD.cut)
    .build();
}
