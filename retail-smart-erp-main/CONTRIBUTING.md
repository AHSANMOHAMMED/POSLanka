# Contributing to Retail Smart ERP

Thank you for your interest in contributing! This guide will help you get started.

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/ravindu2012/retail-smart-erp/issues) to avoid duplicates
2. Open a new issue using the **Bug Report** template
3. Include steps to reproduce, expected behavior, and screenshots if possible

### Suggesting Features

1. Open an issue using the **Feature Request** template
2. Describe the use case and how it benefits the project

### Submitting Code

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** following the guidelines below
5. **Test** your changes locally
6. **Commit** with a clear message:
   ```bash
   git commit -m "Add: brief description of changes"
   ```
7. **Push** to your fork and open a **Pull Request**

### Finding Issues to Work On

- Look for issues labeled [`good first issue`](https://github.com/ravindu2012/retail-smart-erp/labels/good%20first%20issue) — great for newcomers
- Issues labeled [`help wanted`](https://github.com/ravindu2012/retail-smart-erp/labels/help%20wanted) are actively looking for contributors

## Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- npm

### Local Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/retail-smart-erp.git
cd retail-smart-erp

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your local database credentials

# Run migrations
npm run db:migrate

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Code Guidelines

### General
- Write clean, readable code
- Follow the existing project patterns and style
- Keep PRs focused — one feature or fix per PR

### API Routes
- Use `validateBody()` for all request body parsing (never call `request.json()` directly)
- Include tenant filtering in all database queries
- Use `withAuthTenant()` for authenticated routes with RLS
- Follow RESTful conventions (`GET`, `POST`, `PUT`, `DELETE`)

### Frontend
- Use real-time hooks (`useRealtimeData`) for components displaying data
- Use `usePaginatedData` for list pages with server-side pagination
- Use `AsyncCreatableSelect` for dropdowns with large datasets
- Use Tailwind CSS for styling — avoid inline styles
- Use components from `@/components/ui/` where available

### Database
- All new tables must include `tenantId` column
- Run `npm run db:generate` after schema changes
- Migration files must follow `0000_descriptive_name.sql` naming pattern
- Run `npm run validate:migrations` before committing migration changes

### Commit Messages
Use clear, descriptive commit messages:
- `Add: description` — new features
- `Fix: description` — bug fixes
- `Update: description` — improvements to existing features
- `Refactor: description` — code restructuring
- `Docs: description` — documentation changes

## Project Structure

```
src/
├── app/           # Next.js App Router pages and API routes
├── components/    # React components (layout, modals, ui)
├── hooks/         # Custom React hooks
└── lib/           # Core libraries (auth, db, ai, websocket)
```

## Need Help?

- Open a [Discussion](https://github.com/ravindu2012/retail-smart-erp/discussions) for questions
- Check the [README](README.md) for project overview and setup

We appreciate every contribution, no matter how small!
