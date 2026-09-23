// The only shape of a user that leaves the API
export const toPublicUser = ({ _id, email, name, role, emailVerifiedAt, createdAt }) => ({
  id: String(_id),
  email,
  name,
  role,
  emailVerified: Boolean(emailVerifiedAt),
  createdAt,
});
