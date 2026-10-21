/**
 * Produces audit attribution without adding a member ID to a service principal.
 * @param principal Verified caller; optional for internal system operations.
 * @returns Member ID string, service:<clientId> for services, or system for internal calls.
 * @throws TypeError when a service principal has no verified client ID.
 * Used only for createdBy/updatedBy fields, never for member authorization.
 */
function getAuditActor(principal) {
  if (principal?.kind === "service" && principal.isMachine === true) {
    if (typeof principal.clientId !== "string" || !principal.clientId) {
      throw new TypeError("Service audit identity requires a verified client ID");
    }
    return `service:${principal.clientId}`;
  }
  return principal?.userId === undefined ? "system" : String(principal.userId);
}

module.exports = { getAuditActor };
