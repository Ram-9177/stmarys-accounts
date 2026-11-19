import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/api/client';
import { useColleges, useCreateCollege, useSetCollegeStatus } from '@/api/hooks';
import type { College } from '@/api/types';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, Input, PageHeader, Spinner, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { collegeLogo } from '@/lib/colleges';
import { dateTime } from '@/lib/format';

/** Same normalisation the server applies to college codes. */
export function collegeCodeFrom(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);
}

export function CollegesPage() {
  const colleges = useColleges();
  const create = useCreateCollege();
  const setStatus = useSetCollegeStatus();
  const toast = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [error, setError] = useState('');
  const [toggle, setToggle] = useState<College | null>(null);

  const finalCode = collegeCodeFrom(code || name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('College name is required');
    if (finalCode.length < 2 || finalCode.length > 20) return setError('Short code must be 2-20 letters/numbers');
    if (logoUrl && !/^(https:\/\/|\/|assets\/)/i.test(logoUrl.trim())) return setError('Logo URL must be an https:// link or a site path');
    try {
      await create.mutateAsync({ name: name.trim(), code: finalCode, location: location.trim(), logoUrl: logoUrl.trim() });
      toast(`College created: ${finalCode.toUpperCase()}`);
      setName('');
      setCode('');
      setLocation('');
      setLogoUrl('');
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    }
  }

  async function confirmToggle() {
    if (!toggle) return;
    const next = toggle.status === 'inactive' ? 'active' : 'inactive';
    try {
      await setStatus.mutateAsync({ code: toggle.code, status: next });
      toast(`${toggle.code.toUpperCase()} is now ${next}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setToggle(null);
    }
  }

  return (
    <>
      <PageHeader title="Colleges" subtitle="Campuses that keep their own books. Inactive colleges disappear from the sign-in picker." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {colleges.isLoading ? (
            <Spinner className="mx-auto my-10 size-8 text-maroon-700" />
          ) : colleges.error ? (
            <ErrorBox>{errorMessage(colleges.error)}</ErrorBox>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>College</th>
                  <th>Code</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {colleges.data?.map((c) => (
                  <tr key={c.code}>
                    <td>
                      <div className="flex items-center gap-2">
                        <img src={collegeLogo(c)} alt="" className="size-8 rounded-full object-cover" />
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </td>
                    <td className="font-mono font-semibold">{c.code.toUpperCase()}</td>
                    <td>{c.location}</td>
                    <td>
                      <Badge tone={c.status === 'inactive' ? 'danger' : 'success'}>{c.status ?? 'active'}</Badge>
                    </td>
                    <td className="text-xs text-sand-600">
                      {c.createdAt ? dateTime(c.createdAt, true) : ''} {c.createdBy && c.createdBy !== 'system' ? `by ${c.createdBy}` : ''}
                    </td>
                    <td className="text-right">
                      {c.code === 'smgg' ? (
                        <span className="text-xs text-sand-600">Main</span>
                      ) : (
                        <Button size="sm" variant={c.status === 'inactive' ? 'primary' : 'danger'} onClick={() => setToggle(c)}>
                          {c.status === 'inactive' ? 'Activate' : 'Disable'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        <Card title="Add college">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="College name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Short code" hint={finalCode ? `Saved as ${finalCode.toUpperCase()} — used in voucher numbers.` : 'e.g. smvz'}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
            </Field>
            <Field label="Location">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="Logo URL" hint="Optional: https:// link or /assets/… path.">
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            </Field>
            <ErrorBox>{error}</ErrorBox>
            <Button type="submit" loading={create.isPending}>
              Create college
            </Button>
          </form>
        </Card>
      </div>

      <ConfirmDialog
        open={!!toggle}
        title={toggle?.status === 'inactive' ? 'Activate college?' : 'Disable college?'}
        confirmLabel={toggle?.status === 'inactive' ? 'Activate' : 'Disable'}
        danger={toggle?.status !== 'inactive'}
        loading={setStatus.isPending}
        message={
          toggle?.status === 'inactive'
            ? `${toggle?.name} will appear in the sign-in picker again.`
            : `${toggle?.name} will be hidden from the sign-in picker. Its vouchers are kept.`
        }
        onConfirm={confirmToggle}
        onCancel={() => setToggle(null)}
      />
    </>
  );
}
