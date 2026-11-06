import { randomUUID } from "node:crypto"

import { prisma } from "../../../../integrations/prisma/index.ts"

export async function withFailingSecurityAudit<T>(
  action: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z.]+$/.test(action)) throw new Error("Security audit action is invalid.")
  const suffix = randomUUID().replaceAll("-", "_")
  const functionName = `fail_security_audit_${suffix}`
  const triggerName = `fail_security_audit_${suffix}`
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action = '${action}' THEN
        RAISE EXCEPTION 'security audit unavailable';
      END IF;
      RETURN NEW;
    END;
    $$
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON security_audits
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
  `)
  try {
    return await operation()
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON security_audits`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
  }
}
