import mongoose from "mongoose";

// doctors run cases; patients own a personal health record; admins get no patient-data access
export const ROLES = ["admin", "doctor", "patient"];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    role: { type: String, enum: ROLES, default: "doctor" },
    // auth internals: excluded from every query unless explicitly selected
    passwordHash: { type: String, required: true, select: false },
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: Date,
    // proof the person owns the address: requests sent "to this email" only reach verified accounts
    emailVerifiedAt: Date,
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
