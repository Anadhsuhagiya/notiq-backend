# NotiQ — Backend API

**Node.js + Express + MongoDB + Socket.io**

## Setup

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # development
npm start              # production
```

## API Base URL
`http://localhost:5000/api`

## Authentication
JWT Bearer Token. Include in header: `Authorization: Bearer <token>`

## Endpoints

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get current user |
| PATCH | `/auth/me` | Update profile |

### Notifications
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/notifications` | List (paginated, filterable) |
| POST | `/notifications/bulk` | Batch ingest from device |
| GET | `/notifications/unread-count` | Unread count |
| PATCH | `/notifications/read-all` | Mark all read |
| GET | `/notifications/:id` | Get single |
| PATCH | `/notifications/:id/read` | Mark read |
| PATCH | `/notifications/:id/feedback` | Submit AI feedback |
| DELETE | `/notifications/:id` | Soft delete |

### Reminders
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/reminders` | List reminders |
| POST | `/reminders` | Create reminder |
| GET | `/reminders/upcoming` | Upcoming reminders |
| GET | `/reminders/stats` | Stats summary |
| GET | `/reminders/:id` | Get single |
| PATCH | `/reminders/:id` | Update |
| PATCH | `/reminders/:id/status` | Update status (DONE/SNOOZED/DISMISSED) |
| DELETE | `/reminders/:id` | Delete |

### Analytics
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/analytics/summary` | Full analytics summary |
| GET | `/analytics/top-senders` | Top senders |
| GET | `/analytics/warc` | Weekly Active Reminders Completed |

### Integrations
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/integrations` | List integrations |
| GET | `/integrations/gmail/auth-url` | Get OAuth URL |
| GET | `/integrations/gmail/callback` | OAuth callback |
| POST | `/integrations/gmail/sync` | Manual sync |
| POST | `/integrations/calendar/create-event` | Create calendar event |
| DELETE | `/integrations/:source/disconnect` | Disconnect |

### Preferences
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/preferences` | Get preferences |
| PATCH | `/preferences` | Update |
| POST | `/preferences/reset` | Reset to defaults |

## WebSocket Events

Connect with: `io('http://localhost:5000', { auth: { token: '<jwt>' } })`

| Event (Server→Client) | Payload |
|-----------------------|---------|
| `notifications:new` | `{ count, notifications[] }` |
| `reminders:created` | `{ reminders[] }` |
| `reminders:updated` | `{ reminder }` |
| `reminder:due` | `{ reminderId, title, dueDateTime, category }` |

## Tech Stack
- Node.js 20 + Express 4
- MongoDB + Mongoose
- Socket.io 4
- JWT Auth (access + refresh tokens)
- Google APIs (Gmail + Calendar OAuth)
- node-cron (scheduled jobs)
- Winston (logging)
