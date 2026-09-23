// Ties a form control to the error message that concerns it (WCAG 3.3.1, 4.1.2):
// screen readers hear the message when they reach the field, and invalid fields are flagged.
export function fieldProps(error, name, errorId) {
  if (!error) return {};
  const invalid = error.issues?.some((i) => i.field.split(".").pop() === name);
  return { "aria-describedby": errorId, ...(invalid && { "aria-invalid": true }) };
}
