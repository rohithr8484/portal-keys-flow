// Particle Network project credentials
// Project ID and Client Key are publishable. App ID lives under your Web App
// in the Particle Dashboard — paste it here or set VITE_PARTICLE_APP_ID.
export const PARTICLE_PROJECT_ID = "ed5804a3-ff45-4841-8870-329c851906f1";
export const PARTICLE_CLIENT_KEY = "c6COKe91FBlGjueefFMn4rfPreiZQCLV0Ar9InzY";
// Server Key (DO NOT expose in production — kept here per setup notes):
export const PARTICLE_SERVER_KEY = "senYlK4lqTNmDTRwqYqNv0Du0S931XLU4P32DBNh";
export const PARTICLE_APP_ID =
  (import.meta.env.VITE_PARTICLE_APP_ID as string | undefined) ?? "";
