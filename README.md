**Paygrid**


# PayGrid

## Explore Travel. Pay with Crypto.

PayGrid is a travel payment application that makes travel payments easier by enabling seamless crypto payments using **USDC** and **ETH**, PayGrid combines crypto payments, shared expense management, QR-based transfers, and curated travel experiences into one platform Whether you're booking a heritage tour in Rajasthan, reserving a houseboat in Kerala, splitting hotel expenses with friends in Goa, or paying for local travel experiences, PayGrid provides a secure and intuitive payment experience.

Powered by **Particle Network Universal Accounts (EIP-7702)**, users simply connect their wallet and start paying without changing their existing wallet address.


---

# Features

PayGrid reimagines travel payments by combining modern Web3 infrastructure with a familiar payment experience.

The platform includes:

- 👛 Wallet login powered by Particle Network Universal Accounts
- 💳 Crypto payments using **USDC** and **ETH**
- 👥 Split travel expenses with friends and family
- 📱 QR code payment requests
- 🧳 Curated travel packages across India
- ⭐ Save favorite contacts
- 📜 Activity & payment history
- 💼 Transaction management
- 📑 Smart contract support
- ❓ Built-in FAQ and travel assistance
- 🎨 Responsive mobile-first interface

---

# Pay with USDC & ETH

Make secure crypto payments in **USDC** or **ETH** to hotels, restaurants, cafés, transport providers, tour operators, local guides, and fellow travelers.

Whether you're paying for accommodation, transportation, food, shopping, or guided travel experiences, PayGrid keeps every payment simple and secure.

---

# Split Travel Expenses

Traveling with friends or family?

Split expenses instantly using **USDC** or **ETH**, making it easy to settle shared costs for:

- Hotel bookings
- Restaurant bills
- Taxi rides
- Shopping
- Adventure activities
- Tourist attractions

Everyone pays only their share with a few taps.

---

# Receive Crypto

Receive **USDC** or **ETH** instantly by generating a QR code or sharing a payment link.

Perfect for collecting money for:

- Shared hotel bookings
- Group activities
- Transportation
- Dining expenses
- Travel reimbursements

---

# Discover India

Explore curated travel experiences across India's most popular destinations.

Featured destinations include:

- 🏖 Goa Beach Escape (North & South Goa)
- 🌴 Enchanting Kerala (Cochin → Munnar → Thekkady → Alleppey)
- 🕌 Rajasthan Royal Tour (Jaipur → Jodhpur → Udaipur)
- 🏔 Kashmir Valley Retreat ( Srinagar → Gulmarg → Pahalgam )
- 🏍 North East Explorer (Gangtok → Pelling → Darjeeling)
- ❄ Spiritual & Temple Circuit ( Varanasi → Prayagraj → Ayodhya )
- 🌊 Andaman Island Getaway ( Port Blair → Havelock → Neil Island )
- 🛕 Golden Triangle (Delhi • Agra • Jaipur)

Each destination includes highlights, pricing, and the ability to pay using **USDC** or **ETH** directly from the application.

---

# Saved Contacts

Store frequently used travel companions, hotels, merchants, and guides for faster crypto payments throughout your journey.

---

# Activity

Every crypto payment is automatically recorded in an activity feed.

Review:

- Recent payments
- Incoming transfers
- Completed transactions
- Previous travel expenses
- Payment status

---

# Transactions

Manage your crypto transactions from one dashboard.

Current capabilities include:

- Transaction previews
- Transaction history
- Payment confirmation

---

# Smart Contracts

PayGrid is designed to leverage smart contract capabilities for recording activity of seamless travel payments and automated on-chain interactions.



---

# Help Center

An integrated FAQ helps users understand:

- Wallet connection
- Making USDC and ETH payments
- Splitting expenses
- Receiving crypto payments
- Booking travel packages
- Payment confirmations

---

# Technology Stack

- **Next.js 15**
- **React 19**
- **TypeScript**
- **Tailwind CSS v4**
- **Particle Network Universal Accounts SDK**
- **ethers v6**

---

# Partner Technologies

## Particle Network

Particle Network powers wallet authentication through **Universal Accounts (EIP-7702)**, allowing users to continue using their existing wallet while benefiting from account abstraction.

## ZeroDev

ZeroDev provides account abstraction infrastructure together with **Sponsored Gas**, enabling supported transactions without requiring users to maintain native gas tokens. This delivers a smoother onboarding experience and simplifies crypto payments throughout the application.

---

# Supported Networks

PayGrid supports both development and production deployments.

## 🧪 Testnet

- **Arbitrum Sepolia**

Developers and judges can safely explore the application, execute crypto payments, and validate transaction flows without spending real assets.

## 🌐 Mainnet

- **Arbitrum One**

Mainnet support enables real-world travel payments using **USDC** and **ETH**, allowing travelers to pay merchants, split expenses, receive crypto, and book travel experiences.

---

# How It Works

```text
Connect Wallet
        │
        ▼
Particle Universal Account  +  ZeroDev
(EIP-7702)
        │
        ▼
PayGrid Dashboard
        │
 ┌────────────┬─────────────┬──────────────┬─────────────┐
 │            │             │              │             |
 ▼            ▼             ▼              ▼             ▼             
Pay      Split Bills   Packages      Receive          Contacts
        
```

Users connect their wallet through **Particle Network Universal Accounts**.

Once authenticated they can:

- Pay merchants using **USDC** or **ETH**
- Split travel expenses
- Receive crypto payments
- Book travel experiences
- View activity
- Track transaction history

Every payment is previewed before confirmation, providing a transparent and user-friendly payment experience.

---

# Getting Started

```bash
npm install

npm run dev
```

Start the development server:

```text
http://localhost:3000
```

Configure your Particle Network project credentials before launching the application.

---

# Environment Variables

Create a `.env.local` file.

```env
NEXT_PUBLIC_PARTICLE_PROJECT_ID=...

NEXT_PUBLIC_PARTICLE_CLIENT_KEY=...

NEXT_PUBLIC_PARTICLE_APP_ID=...
```

These public client-side credentials are required for Particle Network Universal Accounts.

---

# Project Structure

```text
├── contracts/
│   └── DAppActivityTracker.sol
│
├── src/
│   ├── components/
│   │   ├── ui/
│   │   ├── ParticleUniversalAccount.tsx
│   │   └── UniversalPayPanel.tsx
│   │
│   ├── hooks/
│   │   └── use-mobile.tsx
│   │
│   ├── integrations/
│   │   └── supabase/
│   │
│   ├── lib/
│   │   ├── api/
│   │   ├── activity-tracker.ts
│   │   ├── amounts.ts
│   │   ├── config.server.ts
│   │   ├── error-capture.ts
│   │   ├── error-page.ts
│   │   ├── lovable-error-reporting.ts
│   │   ├── particle-config.ts
│   │   ├── payment-requests.ts
│   │   ├── split.ts
│   │   └── utils.ts
│   │
│   ├── routes/
│   │   ├── README.md
│   │   ├── __root.tsx
│   │   ├── index.tsx
│   │   └── pay.$requestId.tsx
│   │
│   └── types/
│       └── particle-sdk.d.ts
```

---

# Technical Overview

- Wallet authentication is powered by **Particle Network Universal Accounts**.
- Universal Accounts operate in **EIP-7702** mode while preserving the user's existing wallet address.
- ZeroDev provides account abstraction with **Sponsored Gas** support for supported transactions.
- Browser-only SDKs are initialized client-side for full Next.js compatibility.
- The application follows a responsive, mobile-first architecture for a seamless travel experience.
- Modular components make it easy to extend PayGrid with new travel services and payment capabilities.

---

# Current Features

- ✅ Wallet Login via Particle Network
- ✅ Universal Accounts (EIP-7702)
- ✅ Crypto Payments (USDC & ETH)
- ✅ Expense Splitting
- ✅ QR Payment Requests
- ✅ India Travel Packages
- ✅ Saved Contacts
- ✅ Activity Feed & Transaction History
- ✅ Smart Account Integration
- ✅ Sponsored Gas (ZeroDev)
- ✅ Arbitrum Sepolia Support
- ✅ Arbitrum One Support

---

# Roadmap

Future enhancements include:

- Flight reservations
- Hotel booking integrations
- AI-powered travel recommendations
- Personalized itineraries
- Merchant discovery
- Multi-language support
- Rewards and loyalty programs
- Budget analytics
- Additional smart contract-powered travel services
  - Automated merchant settlements
  - Escrow-based travel payments
  - Travel booking automation
  - Programmable payment workflows

  

---

# Why PayGrid?

Travel should be about creating unforgettable memories—not worrying about payments.

PayGrid brings together **USDC** and **ETH** payments, shared travel expenses, destination discovery, and curated travel experiences into one intuitive platform built specifically for travelers.

Whether you're relaxing on Goa's beaches, exploring Rajasthan's historic forts, cruising Kerala's backwaters, or trekking through Ladakh, PayGrid delivers a seamless crypto payment experience designed for modern travel.

---

## License

Built for the **UXMaxx Hackathon**. **General Track + Zero Dev track**

```
