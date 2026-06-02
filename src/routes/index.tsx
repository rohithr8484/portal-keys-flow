import { createFileRoute } from "@tanstack/react-router";
import { ParticleUniversalAccount } from "@/components/ParticleUniversalAccount";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Universal Accounts × MetaMask · Particle Network 7702" },
      {
        name: "description",
        content:
          "Connect MetaMask and use a Particle Network Universal Account (EIP-7702) to spend any token on any chain.",
      },
      { property: "og:title", content: "Universal Accounts × MetaMask" },
      {
        property: "og:description",
        content:
          "One EOA, one balance, every chain — powered by Particle Network Universal Accounts.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen">
      <ParticleUniversalAccount />
    </main>
  );
}
