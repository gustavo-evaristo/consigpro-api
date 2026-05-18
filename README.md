# consigpro-api

Backend API for a WhatsApp bot platform. Allows users to build conversation flows (Kanbans) that are executed automatically when leads message the connected WhatsApp number.

Built with **NestJS**, **Prisma**, and **Baileys** (@whiskeysockets/baileys), following Clean/Hexagonal Architecture.

---

## Overview

Each user connects their own WhatsApp number. When a lead sends a message to that number, the flow engine processes it against the active Kanban, sends the appropriate responses, and tracks conversation progress — all in real time.

### Core concepts

| Concept                  | Description                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------- |
| **Kanban**               | A bot flow. Must have a `phoneNumber` to be activated.                                 |
| **Stage**                | An ordered step within a Kanban.                                                       |
| **StageContent**         | A content item inside a Stage. Types: `TEXT`, `MULTIPLE_CHOICE`, `FREE_INPUT`.         |
| **Answer**               | Options for `MULTIPLE_CHOICE` contents, each with a `score`.                           |
| **Conversation**         | A session between a lead and a Kanban. Has `ACTIVE` or `FINISHED` status.              |
| **ConversationProgress** | Tracks the current position in the flow and whether the bot is waiting for a response. |
| **LeadResponse**         | A lead's reply to a question content, with optional linked answer and score.           |
| **MessageHistory**       | Full message log for a conversation (both BOT and LEAD messages).                      |

---

## Architecture

Clean/Hexagonal Architecture with two main layers:

```
src/
├── domain/               # Framework-agnostic business logic
│   ├── entities/         # Domain entities and value objects (UUID, Password)
│   ├── repositories/     # Abstract repository interfaces
│   └── use-cases/        # One class per business operation
│
└── infra/                # NestJS-specific implementations
    ├── controllers/      # Thin wrappers that delegate to use cases
    ├── database/
    │   └── repositories/ # Prisma implementations of domain interfaces
    ├── dtos/             # Request validation (class-validator)
    ├── responses/        # Response shape DTOs
    ├── authentication/   # JWT passport strategy
    ├── middlewares/      # Global exception filter (CustomExceptionFilter)
    └── whatsapp/         # WhatsApp integration (Baileys + Socket.io)
```

**Data flow:**
`Controller → Use Case → Repository Interface → Prisma Repository → PostgreSQL`

Repository interfaces from `domain/` are bound to Prisma implementations in `infra/database/database.module.ts`.

---

## WhatsApp Integration

Uses **Baileys** (`@whiskeysockets/baileys`) — a lightweight WhatsApp Web API without Puppeteer.

> **Note:** Baileys v7 is ESM-only. Because NestJS compiles to CommonJS, it is loaded via a dynamic `import()` workaround in `baileys.loader.ts` to avoid `require()` errors.

### Session lifecycle

- Sessions are persisted in PostgreSQL (`whatsapp_sessions` table) with credentials and signal keys stored as JSON strings.
- On startup (`onModuleInit`), all existing sessions are restored in parallel batches of 10.
- When a session disconnects with `loggedOut`, the session record is deleted. All other disconnects trigger an automatic reconnect.

### QR code flow

1. Client calls `POST /whatsapp/start`.
2. Server creates a Baileys socket for that user.
3. QR code is generated and emitted via Socket.io (`WhatsappGateway`) to the user's room.
4. Client renders the QR; once scanned, the connection event changes to `open` and `CONNECTED` status is emitted.

### Message handling

Incoming messages go through `handleIncomingMessage`:

1. Groups, broadcasts, and `fromMe` messages are ignored.
2. LID JIDs (new WhatsApp addressing format) are resolved to real phone numbers via `remoteJidAlt` or a contacts sync map.
3. The message is passed to `ProcessMessageUseCase`, which drives the flow engine.

### Follow-up cron

`FollowUpService` runs every 5 minutes. If a lead has not responded in 30 minutes, it sends `"Oi, ainda está por aí? 😊"` and marks `followUpSentAt`.

---

## Flow Engine (`ProcessMessageUseCase`)

Controls how the bot progresses through a Kanban flow:

- **New conversation:** Creates a `Conversation` and `ConversationProgress` at the first stage/content, then starts executing.
- **24h cooldown:** If the last conversation finished within 24 hours, the bot ignores new messages from that lead.
- **Text content:** Sent immediately; advances to the next content automatically.
- **Question content** (`FREE_INPUT` / `MULTIPLE_CHOICE`): Sends the question, sets `waitingForResponse = true`, and stops.
- **Multiple choice validation:** Accepts number or text match. Returns error message listing options if invalid.
- **End of flow:** Marks the conversation as `FINISHED`.

---

## Database

**ORM:** Prisma 7.x — **DB:** PostgreSQL (Supabase)

```
users
└── kanbans
    └── stages
        └── stage_contents
            └── answers

conversations (belongs to kanban)
├── conversation_progress
├── lead_responses
└── message_history

whatsapp_sessions (one per user)
```

All entities use UUID primary keys. Soft deletes via `isDeleted`; soft deactivation via `isActive`.

After modifying the schema:

```bash
npx prisma migrate dev   # Apply and generate migration
npx prisma generate      # Regenerate Prisma client
```

---

## Setup

### Environment variables

```env
PORT=3000
DATABASE_URL=          # PostgreSQL connection string
JWT_SECRET_KEY=        # JWT signing secret
```

### Install & run

```bash
pnpm install

# Development (hot-reload)
pnpm run dev

# Build
pnpm run build

# Production
pnpm run start:prod
```

### Code quality

```bash
pnpm run lint      # ESLint with auto-fix
pnpm run format    # Prettier
```

### Tests

```bash
pnpm run test      # All Jest tests (*.spec.ts)
```

Swagger UI is available at `/api` when the server is running.

---

## Real-time (Socket.io)

`WhatsappGateway` emits events scoped to each user's room (`userId`):

| Event         | Payload                                          | When                         |
| ------------- | ------------------------------------------------ | ---------------------------- |
| `qr`          | base64 PNG data URL                              | QR code ready to scan        |
| `status`      | `"CONNECTED"` \| `"DISCONNECTED"`                | Connection state changes     |
| `new-message` | `{ conversationId, sender, content, createdAt }` | Any message sent or received |

---

## API Modules

| Module         | Routes                                             | Auth         |
| -------------- | -------------------------------------------------- | ------------ |
| Users          | `POST /users`, `POST /auth/login`, `GET /users/me` | Public / JWT |
| Kanbans        | CRUD + activate/deactivate/duplicate               | JWT          |
| Stages         | CRUD                                               | JWT          |
| Stage Contents | CRUD                                               | JWT          |
| Conversations  | List, get details, list leads, send message        | JWT          |
| Analytics      | Get summary                                        | JWT          |
| WhatsApp       | `POST /whatsapp/start`, `DELETE /whatsapp/logout`  | JWT          |
