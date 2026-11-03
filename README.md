# Sarala Birla University Complaint Portal

A student complaint portal using HTML, CSS, and browser JavaScript, with a Node.js/Express API and MySQL database.

## Requirements

- Node.js 20 or newer
- MySQL 8 or a compatible MySQL server

## Run locally

1. For a new database, create the database and tables by running `database/schema.sql`. For an existing installation, apply the migrations in order: `001_location_details.sql`, `002_in_progress_status.sql`, `003_v2_features.sql` (if not already applied), and `004_session_version.sql`.
2. Copy `.env.example` to `.env` and set the MySQL connection values. Replace `SESSION_SECRET` with a long random secret. Keep `.env` private.
3. Install dependencies with `npm install`.
4. Create the first admin account with `npm run admin:create`. Admin accounts cannot be created through student registration.
5. Start the site with `npm start` and open `http://localhost:3000`.

An operator can reset an account password from an interactive terminal with `npm run password:reset`. The password is entered with masked input and stored as a bcrypt hash.

The app serves both the frontend and API from the same origin. Student registration signs the student in immediately. Admin progress notes are written for students to read in the portal; there is no separate internal-note feature.

Students can add building, floor, and room details to a complaint. Admin search includes these fields. Admins can search complaints, filter by status and priority, inspect details, and record a status update with an optional student-visible progress note. Admin complaint records are paginated, and dashboard counts come from the database. Students can see their own complaints and progress history. An anonymous complaint hides student identity from admin API responses while retaining a private account link for tracking.

The frontend has separate pages: `/login.html`, `/register.html`, `/student.html`, and `/admin.html`. After sign-in, the account role sends each user to the matching dashboard. Dashboard pages also verify the role through the API before loading complaint data.

## Status and priority

Statuses are pending, in review, in progress, resolved, and rejected. Priorities are low, medium, and high. Priority indicates the student's assessment and does not promise a response time.

## Security and deployment

- Passwords are hashed with bcrypt (minimum 6 characters; longer passwords are safer, and bcrypt's 72-byte input limit applies). Session data is stored in MySQL.
- Session cookies are HTTP only, same-site strict, and secure in production. Use HTTPS in production.
- State-changing API requests require a CSRF token. Login and registration requests are rate limited.
- Admin access is role checked on the server. Anonymous student details are omitted from admin API responses.
- Keep dependencies updated, restrict database access, back up the database securely, and review operational logs for personal data before production.
- The privacy and terms pages name Sarala Birla University. The University still needs to add its approved office contact and retention period and approve the text before launch.
- File uploads are not enabled.

For production, set `NODE_ENV=production`, use a strong unique `SESSION_SECRET`, and run behind an HTTPS reverse proxy. Configure MySQL with a dedicated least-privilege application account instead of using the root account.
