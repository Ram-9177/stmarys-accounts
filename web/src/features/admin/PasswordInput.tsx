import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { generateTempPassword } from './permissions';

/** Password field with show/hide, "Generate" (strong temporary password) and copy. */
export function PasswordInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [show, setShow] = useState(false);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast('Password copied');
    } catch {
      toast('Could not copy - select and copy it manually', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          className="font-mono"
        />
        <Button size="sm" variant="ghost" className="h-10" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? 'Hide' : 'Show'}
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            onChange(generateTempPassword());
            setShow(true);
          }}
        >
          Generate strong password
        </Button>
        <Button size="sm" variant="secondary" onClick={copy} disabled={!value}>
          Copy
        </Button>
      </div>
    </div>
  );
}
