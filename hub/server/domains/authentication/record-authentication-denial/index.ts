export async function recordAuthenticationDenial(
  primaryError: Error,
  writeAudit: () => Promise<unknown>,
): Promise<void> {
  try {
    await writeAudit()
  } catch (auditError) {
    throw new AggregateError(
      [primaryError, auditError],
      "The authentication denial and its audit could not both be recorded.",
      { cause: auditError },
    )
  }
}
