import type { AuditLog, ManagedUser, Permission } from '@/api/types';
import { actionTone, auditCsv, csvCell, filterAudit, prettyDetails, EMPTY_AUDIT_FILTER } from './audit';
import { collegeCodeFrom } from './CollegesPage';
import {
  ALL_PERMISSIONS,
  assignableColleges,
  assignablePermissions,
  assignableRoles,
  canResetPassword,
  generateTempPassword,
  manageBlockReason,
  presetFor,
  scopePermissions,
  validatePassword,
  validateUsername,
  type Actor,
} from './permissions';

const superAdmin: Actor = {
  username: 'admin',
  role: 'admin',
  baseRole: 'admin',
  isSuperAdmin: true,
  collegeAccess: ['smgg', 'smwec', 'smhyd'],
  permissions: [...ALL_PERMISSIONS],
};

const delegated: Actor = {
  username: 'manager',
  role: 'admin',
  baseRole: 'admin',
  isSuperAdmin: false,
  collegeAccess: ['smgg'],
  permissions: ['create_users', 'reset_passwords', 'block_users', 'create_voucher', 'view_own_vouchers', 'view_all_vouchers', 'print_voucher'],
};

function target(over: Partial<ManagedUser> = {}): ManagedUser {
  return {
    username: 'clerk',
    displayName: 'clerk',
    fullName: '',
    email: '',
    role: 'user',
    baseRole: 'user',
    isSuperAdmin: false,
    status: 'active',
    college: 'smgg',
    collegeAccess: ['smgg'],
    permissions: ['create_voucher', 'view_own_vouchers'],
    mustChangePassword: false,
    lastLogin: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('what an actor may assign', () => {
  it('a delegated admin cannot offer permissions they lack', () => {
    const allowed = assignablePermissions(delegated);
    expect(allowed.has('create_voucher')).toBe(true);
    expect(allowed.has('delete_voucher')).toBe(false);
    expect(allowed.has('manage_permissions')).toBe(false);
    expect(allowed.has('create_admin')).toBe(false);
    // the preset is clipped to the actor's own permissions
    const preset = presetFor('admin', delegated);
    expect(preset).not.toContain('edit_voucher');
    expect(preset.every((p: Permission) => allowed.has(p))).toBe(true);
  });

  it('roles: admin needs create_admin, head needs super admin or head', () => {
    expect(assignableRoles(delegated)).toEqual(['user']);
    expect(assignableRoles({ ...delegated, permissions: [...delegated.permissions, 'create_admin'] })).toEqual(['user', 'admin']);
    expect(assignableRoles({ ...delegated, role: 'head', permissions: [...delegated.permissions, 'create_admin'] })).toEqual(['user', 'admin', 'head']);
    expect(assignableRoles(superAdmin)).toEqual(['user', 'admin', 'head']);
  });

  it('colleges are limited to the actor\'s access', () => {
    expect(assignableColleges(delegated, ['smgg', 'smwec', 'smhyd'])).toEqual(['smgg']);
    expect(assignableColleges(superAdmin, ['smgg', 'smwec'])).toEqual(['smgg', 'smwec']);
  });

  it('view scope follows the role like the server', () => {
    expect(scopePermissions('user', ['view_all_vouchers', 'create_voucher'])).toEqual(['create_voucher', 'view_own_vouchers']);
    expect(scopePermissions('admin', ['create_voucher'])).toEqual(['create_voucher', 'view_own_vouchers', 'view_all_vouchers']);
  });
});

describe('who an actor may manage', () => {
  it('blocks main admins, other colleges, heads and more privileged users', () => {
    expect(manageBlockReason(delegated, target())).toBeNull();
    expect(manageBlockReason(delegated, target({ isSuperAdmin: true }))).toMatch(/main administrator/);
    expect(manageBlockReason(delegated, target({ college: 'smwec' }))).toMatch(/college/);
    expect(manageBlockReason(delegated, target({ role: 'head', baseRole: 'admin' }))).toMatch(/Head/);
    expect(manageBlockReason(delegated, target({ role: 'admin', baseRole: 'admin' }))).toMatch(/Create Admin/);
    expect(manageBlockReason(delegated, target({ permissions: ['delete_voucher'] }))).toMatch(/Delete Voucher/);
    expect(manageBlockReason(superAdmin, target({ isSuperAdmin: true }))).toBeNull();
  });

  it('changing a main admin key needs change_admin_key', () => {
    expect(canResetPassword(delegated, target({ isSuperAdmin: true }))).toBe(false);
    expect(canResetPassword({ ...delegated, permissions: [...delegated.permissions, 'change_admin_key'] }, target({ isSuperAdmin: true }))).toBe(true);
    expect(canResetPassword(delegated, target())).toBe(true);
  });
});

describe('validation and passwords', () => {
  it('validates usernames and passwords like the server', () => {
    expect(validateUsername('Clerk.1')).toBeNull();
    expect(validateUsername('superadmin')).toMatch(/reserved/);
    expect(validateUsername('bad name')).toMatch(/letters/);
    expect(validatePassword('short')).toMatch(/8/);
    expect(validatePassword('stmarys@1234')).toMatch(/default/);
    expect(validatePassword('A-Good-Pass-9')).toBeNull();
  });

  it('generates strong temporary passwords', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(12);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[#$%&*+\-=?@]/);
      expect(p).not.toMatch(/[0O1lI]/);
      expect(validatePassword(p)).toBeNull();
    }
  });

  it('normalises college codes', () => {
    expect(collegeCodeFrom('St Marys Vizag!')).toBe('stmarysvizag');
    expect(collegeCodeFrom(' SMVZ ')).toBe('smvz');
  });
});

describe('audit helpers', () => {
  const logs: AuditLog[] = [
    { id: 3, actor: 'baji', action: 'login', entityType: 'user', entityId: 'baji', details: 'Login successful', ip: '1.1.1.1', createdAt: '2026-11-19T06:00:00Z' },
    { id: 2, actor: 'clerk', action: 'create_voucher', entityType: 'voucher', entityId: '42', details: '{"amount":1500,"head":"Diesel"}', ip: '', createdAt: '2026-11-18T06:00:00Z' },
    { id: 1, actor: 'x', action: 'login_failed', entityType: 'user', entityId: 'x', details: 'Invalid credentials', ip: '', createdAt: '2026-11-10T06:00:00Z' },
  ];

  it('filters by actor, action, date range and text', () => {
    expect(filterAudit(logs, { ...EMPTY_AUDIT_FILTER, actor: 'clerk' }).map((l) => l.id)).toEqual([2]);
    expect(filterAudit(logs, { ...EMPTY_AUDIT_FILTER, action: 'login' }).map((l) => l.id)).toEqual([3]);
    expect(filterAudit(logs, { ...EMPTY_AUDIT_FILTER, from: '2026-11-15' }).map((l) => l.id)).toEqual([3, 2]);
    expect(filterAudit(logs, { ...EMPTY_AUDIT_FILTER, to: '2026-11-15' }).map((l) => l.id)).toEqual([1]);
    expect(filterAudit(logs, { ...EMPTY_AUDIT_FILTER, text: 'diesel' }).map((l) => l.id)).toEqual([2]);
  });

  it('pretty-prints JSON details and leaves plain text alone', () => {
    expect(prettyDetails('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyDetails('Soft delete')).toBe('Soft delete');
    expect(prettyDetails('{broken')).toBe('{broken');
  });

  it('escapes CSV cells and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(null)).toBe('');
    const csv = auditCsv(logs.slice(1, 2), () => 'T');
    expect(csv.split('\r\n')[1]).toBe('T,clerk,create_voucher,voucher,42,"{""amount"":1500,""head"":""Diesel""}",');
  });

  it('colours actions', () => {
    expect(actionTone('login')).toBe('success');
    expect(actionTone('login_failed')).toBe('danger');
    expect(actionTone('delete_voucher')).toBe('danger');
    expect(actionTone('create_user')).toBe('credit');
    expect(actionTone('reset_user_password')).toBe('maroon');
  });
});
