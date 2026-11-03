const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const protectedPage = document.body?.dataset.page === 'admin' || document.body?.dataset.page === 'student';
if (protectedPage) document.documentElement.classList.add('auth-check-pending');

let csrfToken = '';
let currentAdminDetailId = null;
let currentStudentDetailId = null;
let studentPage = 1;
let adminPage = 1;
let studentComplaints = [];
let adminComplaints = [];
let adminLoadSeq = 0;

const statusNames = {
  pending: 'Pending',
  in_review: 'In Review',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  rejected: 'Rejected'
};

const departmentsList = [
  'Facilities & Estate',
  'Electrical Maintenance',
  'IT Infrastructure',
  'Housekeeping & Sanitation',
  'Campus Security',
  'Hostel Administration',
  'General Support'
];

const formatDate = value => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

async function request(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function toast(message) {
  const box = $('#global-message');
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('show'), 3800);
}

function formMessage(form, message, success = false) {
  const element = $('.form-message', form);
  if (!element) return;
  element.textContent = message;
  element.style.color = success ? '#0d9488' : '#e11d48';
}

function routeFor(user) {
  return user.role === 'admin' ? '/admin.html' : '/student.html';
}

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('sbu_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeToggleIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('sbu_theme', next);
  updateThemeToggleIcon(next);
}

function updateThemeToggleIcon(theme) {
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Image File Upload Helper
function setupImageUpload() {
  const fileInput = $('#image-file');
  const hiddenInput = $('#image-data-url');
  const previewBox = $('#image-preview');
  const previewImg = $('#image-preview-img');
  const removeBtn = $('#remove-image-btn');
  if (!fileInput || !hiddenInput || !previewBox) return;

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('Image file is too large. Max size is 2MB.');
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      hiddenInput.value = event.target.result;
      if (previewImg) previewImg.src = event.target.result;
      previewBox.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', e => {
      e.preventDefault();
      fileInput.value = '';
      hiddenInput.value = '';
      if (previewImg) previewImg.src = '';
      previewBox.style.display = 'none';
    });
  }
}

// Complaint Card & Row Renderers
function complaintCard(item) {
  const location = [item.location, item.building, item.floor && `Floor ${item.floor}`, item.room && `Room ${item.room}`].filter(Boolean).join(' / ');
  const imgThumb = item.imageUrl ? `<div style="margin-top:10px;"><img src="${item.imageUrl}" alt="Evidence" style="max-height:80px; max-width:120px; object-fit:cover; border-radius:6px; border:1px solid var(--border-light);"></div>` : '';
  const ratingBadge = item.rating ? `<span class="badge" style="background:var(--brand-gold-subtle); color:var(--brand-gold);">⭐ ${item.rating}/5 Rated</span>` : '';

  return `<article class="complaint-item" tabindex="0" role="button" data-complaint-id="${Number(item.id)}">
    <div class="complaint-item-top">
      <h3>${escapeHtml(item.category)} — ${escapeHtml(location)}</h3>
      <span class="badge status-${escapeHtml(item.status)}">${escapeHtml(statusNames[item.status] || item.status)}</span>
    </div>
    <div class="complaint-code-dept">
      <span class="code-pill">${escapeHtml(item.trackingCode)}</span>
      <span class="dept-pill">• Dept: ${escapeHtml(item.assignedDepartment || 'General Support')}</span>
    </div>
    <p class="complaint-excerpt">${escapeHtml(item.description.slice(0, 160))}${item.description.length > 160 ? '...' : ''}</p>
    ${imgThumb}
    <div class="complaint-meta">
      <span class="priority-${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span>
      ${ratingBadge}
      <span style="margin-left:auto; font-size:0.78rem; color:var(--text-muted);">${formatDate(item.createdAt)}</span>
    </div>
  </article>`;
}


function adminComplaintRow(item) {
  const location = [item.location, item.building, item.room].filter(Boolean).join(' / ');
  const student = item.anonymous ? '🔒 Anonymous Student' : `${escapeHtml(item.studentName || 'Student')} <br><small style="color:var(--text-muted);">${escapeHtml(item.studentNumber || '')}</small>`;
  const rating = item.rating ? `⭐ ${item.rating}/5` : '—';
  return `<tr class="complaint-row" tabindex="0" role="button" data-complaint-id="${Number(item.id)}" data-admin="true">
    <td><strong>${escapeHtml(item.trackingCode)}</strong><br><span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(item.category)}</span></td>
    <td>${student}</td>
    <td>${escapeHtml(location)}</td>
    <td><span style="font-size:0.85rem; font-weight:600;">${escapeHtml(item.assignedDepartment || 'General')}</span></td>
    <td><span class="badge status-${escapeHtml(item.status)}">${escapeHtml(statusNames[item.status] || item.status)}</span></td>
    <td><span class="priority-${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span></td>
    <td>${rating}</td>
    <td>${formatDate(item.createdAt)}</td>
  </tr>`;
}

// Load Student Complaints
async function loadStudentComplaints() {
  const params = new URLSearchParams({ page: String(studentPage) });
  if ($('#student-search')?.value.trim()) params.set('q', $('#student-search').value.trim());
  if ($('#student-status-filter')?.value) params.set('status', $('#student-status-filter').value);

  const data = await request(`/api/complaints/mine?${params}`);
  if (studentPage > data.pagination.totalPages) {
    studentPage = data.pagination.totalPages;
    return loadStudentComplaints();
  }

  const totalEl = $('#student-total');
  if (totalEl) totalEl.textContent = data.pagination.total.toLocaleString();
  studentComplaints = data.complaints;

  const listContainer = $('#student-complaints');
  if (listContainer) {
    listContainer.innerHTML = data.complaints.length
      ? data.complaints.map(complaintCard).join('')
      : (data.pagination.total
          ? '<p style="text-align:center; padding:30px; color:var(--text-muted);">No reports match your filters.</p>'
          : `<div style="text-align:center; padding:40px; background:var(--bg-primary); border-radius:var(--radius-sm);">
               <h3 style="margin-bottom:8px;">No complaints submitted yet</h3>
               <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:16px;">Submit your first campus report using the form on the left.</p>
             </div>`);
  }
  updatePager('student', data.pagination);
}

// Load Admin Complaints & Analytics
async function loadAdminComplaints() {
  const params = new URLSearchParams();
  params.set('page', String(adminPage));
  if ($('#admin-search')?.value.trim()) params.set('q', $('#admin-search').value.trim());
  if ($('#status-filter')?.value) params.set('status', $('#status-filter').value);
  if ($('#priority-filter')?.value) params.set('priority', $('#priority-filter').value);
  if ($('#location-filter')?.value) params.set('location', $('#location-filter').value);
  if ($('#category-filter')?.value) params.set('category', $('#category-filter').value);
  if ($('#date-from-filter')?.value) params.set('from', $('#date-from-filter').value);
  if ($('#date-to-filter')?.value) params.set('to', $('#date-to-filter').value);
  if ($('#admin-sort-filter')?.value) params.set('sort', $('#admin-sort-filter').value);

  const seq = ++adminLoadSeq;
  const data = await request(`/api/admin/complaints?${params}`);
  if (seq !== adminLoadSeq) return;

  if (adminPage > data.pagination.totalPages) {
    adminPage = data.pagination.totalPages;
    return loadAdminComplaints();
  }

  adminComplaints = data.complaints;
  $('#pending-count').textContent = data.counts.pending || 0;
  $('#in-review-count').textContent = data.counts.inReview || 0;
  $('#in-progress-count').textContent = data.counts.inProgress || 0;
  $('#resolved-count').textContent = data.counts.resolved || 0;
  $('#rejected-count').textContent = data.counts.rejected || 0;
  $('#total-count').textContent = data.counts.total || 0;

  $('#admin-results-summary').textContent = `Showing ${data.complaints.length ? ((data.pagination.page - 1) * data.pagination.limit + 1) : 0}–${Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)} of ${Number(data.pagination.total).toLocaleString()} complaints`;
  $('#admin-complaints').innerHTML = data.complaints.length
    ? data.complaints.map(adminComplaintRow).join('')
    : '<tr><td colspan="8" style="text-align:center; padding:36px; color:var(--text-muted);">No campus complaints match these filters.</td></tr>';
  updatePager('admin', data.pagination);
}

// Load Admin Analytics Charts
async function loadAdminAnalytics() {
  const container = $('#analytics-container');
  if (!container) return;
  try {
    const data = await request('/api/admin/analytics');
    const maxCat = Math.max(...data.categories.map(c => c.count), 1);
    const maxDept = Math.max(...data.departments.map(d => d.count), 1);

    container.innerHTML = `
      <div class="chart-card">
        <h3>Complaints by Category</h3>
        ${data.categories.map(c => `
          <div class="bar-chart-row">
            <div class="bar-chart-label"><span>${escapeHtml(c.category)}</span><strong>${c.count}</strong></div>
            <div class="bar-chart-track"><div class="bar-chart-fill" style="width: ${(c.count / maxCat) * 100}%;"></div></div>
          </div>
        `).join('')}
      </div>
      <div class="chart-card">
        <h3>Workload by Department</h3>
        ${data.departments.map(d => `
          <div class="bar-chart-row">
            <div class="bar-chart-label"><span>${escapeHtml(d.department)}</span><strong>${d.count}</strong></div>
            <div class="bar-chart-track"><div class="bar-chart-fill" style="width: ${(d.count / maxDept) * 100}%; background:linear-gradient(90deg, #6366f1, #a855f7);"></div></div>
          </div>
        `).join('')}
      </div>
      <div class="chart-card">
        <h3>Resolution Satisfaction</h3>
        <div style="text-align:center; padding:20px 0;">
          <strong style="font-size:3rem; color:var(--accent-primary); font-family:var(--font-heading);">${data.satisfaction.avgRating} / 5.0</strong>
          <p style="color:var(--text-muted); font-size:0.9rem; margin-top:6px;">Based on ${data.satisfaction.ratedCount} student ratings</p>
        </div>
      </div>
    `;
  } catch (err) {
    toast('Failed to load analytics.');
  }
}

function updatePager(name, pagination) {
  const label = $(`#${name}-page-label`);
  if (!label || !pagination) return;
  label.textContent = `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total)`;
  const prev = $(`[data-action="${name}-prev"]`);
  const next = $(`[data-action="${name}-next"]`);
  if (prev) prev.disabled = pagination.page <= 1;
  if (next) next.disabled = pagination.page >= pagination.totalPages;
}

// Open Complaint Modal (Student or Admin)
async function openComplaint(id, admin) {
  const dialog = $('#detail-dialog');
  const content = $('#detail-content');
  if (!dialog || !content) return;

  if (!admin) {
    const item = studentComplaints.find(row => Number(row.id) === Number(id));
    if (!item) return;
    currentStudentDetailId = id;
    const location = [item.location, item.building, item.floor && `Floor ${item.floor}`, item.room && `Room ${item.room}`].filter(Boolean).join(' / ');
    const trackingSteps = ['pending', 'in_review', 'in_progress', 'resolved'];
    const currentStep = trackingSteps.indexOf(item.status);
    const progress = item.status === 'rejected'
      ? '<p style="color:#e11d48; font-weight:600; margin-bottom:20px;">This report was closed as rejected.</p>'
      : `<ol class="status-track" aria-label="Progress">${trackingSteps.map((st, i) => `<li class="${i < currentStep ? 'complete' : ''} ${i === currentStep ? 'current' : ''}"><span>${i < currentStep ? '✓' : i + 1}</span><strong>${escapeHtml(statusNames[st])}</strong></li>`).join('')}</ol>`;

    const imgBlock = item.imageUrl ? `<div style="margin:16px 0;"><img src="${item.imageUrl}" alt="Evidence" style="max-width:100%; max-height:260px; border-radius:8px; border:1px solid var(--border-light);"></div>` : '';

    let feedbackSection = '';
    if (item.status === 'resolved' && !item.rating) {
      feedbackSection = `<div style="margin-top:24px; padding:18px; background:var(--bg-primary); border-radius:var(--radius-sm); border:1px solid var(--border-light);">
        <h3 style="font-size:1.05rem; margin-bottom:8px;">Rate Resolution Quality</h3>
        <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:12px;">Are you satisfied with how this issue was resolved?</p>
        <form id="student-feedback-form">
          <div class="star-rating" id="star-picker">
            <span data-star="1">★</span><span data-star="2">★</span><span data-star="3">★</span><span data-star="4">★</span><span data-star="5">★</span>
          </div>
          <input type="hidden" name="rating" id="rating-input" value="5">
          <textarea name="feedbackNote" placeholder="Optional comments or feedback..." style="width:100%; margin-top:10px; padding:8px; border:1px solid var(--border-light); border-radius:var(--radius-sm); background:var(--bg-card); color:var(--text-main);" rows="2" maxlength="500"></textarea>
          <button class="button button-primary button-small" type="submit" style="margin-top:10px;">Submit Rating</button>
        </form>
      </div>`;
    } else if (item.status === 'resolved' && item.rating) {
      feedbackSection = `<div style="margin-top:20px; padding:14px; background:var(--bg-primary); border-radius:var(--radius-sm); border:1px solid var(--border-light);">
        <strong>⭐ Your Rating: ${item.rating}/5 stars</strong>
        ${item.feedbackNote ? `<p style="margin-top:6px; font-size:0.9rem; color:var(--text-muted);">"${escapeHtml(item.feedbackNote)}"</p>` : ''}
      </div>`;
    }

    if (item.status === 'resolved' || item.status === 'rejected') {
      feedbackSection += `<div style="margin-top:16px;">
        <details>
          <summary style="font-weight:600; cursor:pointer; color:var(--accent-secondary); font-size:0.9rem;">Issue persists? Request Reopen</summary>
          <form id="student-reopen-form" style="margin-top:10px;">
            <textarea name="feedbackNote" placeholder="Explain why this needs reopening (min 5 chars)..." style="width:100%; padding:8px; border:1px solid var(--border-light); border-radius:var(--radius-sm); background:var(--bg-card); color:var(--text-main);" rows="2" required minlength="5" maxlength="500"></textarea>
            <button class="button button-secondary button-small" type="submit" style="margin-top:8px;">Submit Reopen Request</button>
          </form>
        </details>
      </div>`;
    }

    content.innerHTML = `
      ${progress}
      <div class="detail-grid">
        <div class="detail-field"><span>Tracking Number</span><strong>${escapeHtml(item.trackingCode)}</strong> <button class="text-button" data-copy-tracking="${escapeHtml(item.trackingCode)}" style="font-size:0.75rem;">Copy</button></div>
        <div class="detail-field"><span>Status</span><strong><span class="badge status-${escapeHtml(item.status)}">${escapeHtml(statusNames[item.status])}</span></strong></div>
        <div class="detail-field"><span>Location</span><strong>${escapeHtml(location)}</strong></div>
        <div class="detail-field"><span>Department</span><strong>${escapeHtml(item.assignedDepartment || 'General Support')}</strong></div>
      </div>
      <p style="font-size:0.95rem; line-height:1.6; margin-bottom:12px;">${escapeHtml(item.description)}</p>
      ${imgBlock}
      <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:20px;">Last updated ${formatDate(item.updatedAt)}</p>
      <h3 style="font-size:1.1rem; margin-bottom:10px;">Progress History</h3>
      ${item.updates?.length ? `<ul style="list-style:none; display:flex; flex-direction:column; gap:10px;">${item.updates.map(u => `<li style="padding:10px 14px; background:var(--bg-primary); border-radius:var(--radius-sm); border-left:3px solid var(--accent-primary);"><strong>${escapeHtml(statusNames[u.status])}</strong> <span style="font-size:0.78rem; color:var(--text-muted); float:right;">${formatDate(u.createdAt)}</span>${u.note ? `<p style="margin-top:4px; font-size:0.88rem; color:var(--text-muted);">${escapeHtml(u.note)}</p>` : ''}</li>`).join('')}</ul>` : '<p style="color:var(--text-muted); font-size:0.9rem;">No progress updates yet.</p>'}
      ${feedbackSection}
    `;
  } else {
    const data = await request(`/api/admin/complaints/${id}`);
    const item = data.complaint;
    currentAdminDetailId = id;
    const location = [item.location, item.building, item.room].filter(Boolean).join(' / ');
    const imgBlock = item.imageUrl ? `<div style="margin:16px 0;"><img src="${item.imageUrl}" alt="Evidence" style="max-width:100%; max-height:280px; border-radius:8px; border:1px solid var(--border-light);"></div>` : '';

    content.innerHTML = `
      <div class="detail-grid">
        <div class="detail-field"><span>Tracking Number</span><strong>${escapeHtml(item.trackingCode)}</strong></div>
        <div class="detail-field"><span>Student</span><strong>${item.anonymous ? '🔒 Anonymous' : `${escapeHtml(item.studentName)} (${escapeHtml(item.studentNumber)})`}</strong></div>
        <div class="detail-field"><span>Location</span><strong>${escapeHtml(location)}</strong></div>
        <div class="detail-field"><span>Category & Priority</span><strong>${escapeHtml(item.category)} / ${escapeHtml(item.priority)}</strong></div>
      </div>
      <p style="font-size:0.95rem; line-height:1.6; margin-bottom:12px;">${escapeHtml(item.description)}</p>
      ${imgBlock}
      <form id="admin-status-form" style="margin-top:20px; background:var(--bg-primary); padding:20px; border-radius:var(--radius-sm); border:1px solid var(--border-light);">
        <h3 style="font-size:1.1rem; margin-bottom:14px;">Update Status & Department</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:14px;">
          <div>
            <label style="font-size:0.85rem; font-weight:700; display:block; margin-bottom:4px;">Status</label>
            <select name="status" style="width:100%; padding:8px; border:1px solid var(--border-light); border-radius:var(--radius-sm); background:var(--bg-card); color:var(--text-main);">
              ${Object.entries(statusNames).map(([k, v]) => `<option value="${k}" ${k === item.status ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.85rem; font-weight:700; display:block; margin-bottom:4px;">Assign Department</label>
            <select name="department" style="width:100%; padding:8px; border:1px solid var(--border-light); border-radius:var(--radius-sm); background:var(--bg-card); color:var(--text-main);">
              ${departmentsList.map(dept => `<option value="${dept}" ${dept === item.assignedDepartment ? 'selected' : ''}>${dept}</option>`).join('')}
            </select>
          </div>
        </div>
        <label style="font-size:0.85rem; font-weight:700; display:block; margin-bottom:4px;">Progress Note</label>
        <textarea name="note" rows="3" maxlength="500" placeholder="Write a resolution update for the student..." style="width:100%; padding:8px; border:1px solid var(--border-light); border-radius:var(--radius-sm); background:var(--bg-card); color:var(--text-main);"></textarea>
        <button class="button button-primary button-small" type="submit" style="margin-top:12px;">Save Status Update</button>
      </form>
      <h3 style="font-size:1.1rem; margin:24px 0 10px;">Update History</h3>
      ${data.updates.length ? `<ul style="list-style:none; display:flex; flex-direction:column; gap:10px;">${data.updates.map(u => `<li style="padding:10px 14px; background:var(--bg-primary); border-radius:var(--radius-sm);"><strong>${escapeHtml(statusNames[u.status])}</strong> <span style="font-size:0.78rem; color:var(--text-muted); float:right;">${formatDate(u.createdAt)}</span>${u.note ? `<p style="margin-top:4px; font-size:0.88rem; color:var(--text-muted);">${escapeHtml(u.note)}</p>` : ''}</li>`).join('')}</ul>` : '<p style="color:var(--text-muted);">No updates recorded yet.</p>'}
    `;
  }

  if (!dialog.open) dialog.showModal();
}

// Global Click & Submit Event Listeners
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  try {
    const passwordToggle = event.target.closest('[data-toggle-password]');
    if (passwordToggle) {
      const passwordInput = $(passwordToggle.dataset.togglePassword);
      if (!passwordInput) return;
      const revealPassword = passwordInput.type === 'password';
      passwordInput.type = revealPassword ? 'text' : 'password';
      passwordToggle.textContent = revealPassword ? 'Hide' : 'Show';
      passwordToggle.setAttribute('aria-pressed', String(revealPassword));
      return;
    }

    if (event.target.id === 'theme-toggle' || event.target.closest('#theme-toggle')) {
      toggleTheme();
      return;
    }
    if (action === 'logout') {
      await request('/api/auth/logout', { method: 'POST' });
      window.location.assign('/');
      return;
    }
    if (action === 'refresh-student') await loadStudentComplaints();
    if (action === 'refresh-admin') await loadAdminComplaints();
    if (action === 'toggle-analytics') {
      const sec = $('#analytics-section');
      if (sec) {
        const isHidden = sec.style.display === 'none';
        sec.style.display = isHidden ? 'block' : 'none';
        $('#toggle-analytics-btn').textContent = isHidden ? 'Hide summary' : 'View summary';
        if (isHidden) await loadAdminAnalytics();
      }
      return;
    }
    if (action === 'export-admin-csv') {
      const csvCell = val => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const rows = [
        ['Tracking ID', 'Category', 'Location', 'Building', 'Department', 'Priority', 'Status', 'Rating', 'Submitted'],
        ...adminComplaints.map(i => [i.trackingCode, i.category, i.location, i.building, i.assignedDepartment, i.priority, statusNames[i.status] || i.status, i.rating || '', formatDate(i.createdAt)])
      ];
      const blob = new Blob([`﻿${rows.map(r => r.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sbu-complaints-export.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${adminComplaints.length} complaints to CSV.`);
    }
    if (action === 'student-prev' && studentPage > 1) { studentPage--; await loadStudentComplaints(); }
    if (action === 'student-next') { studentPage++; await loadStudentComplaints(); }
    if (action === 'admin-prev' && adminPage > 1) { adminPage--; await loadAdminComplaints(); }
    if (action === 'admin-next') { adminPage++; await loadAdminComplaints(); }
    if (action === 'close-dialog') $('#detail-dialog')?.close();
    if (action === 'clear-student-filters') {
      $('#student-search').value = '';
      $('#student-status-filter').value = '';
      studentPage = 1;
      await loadStudentComplaints();
    }
    if (action === 'clear-admin-filters') {
      ['admin-search', 'status-filter', 'priority-filter', 'location-filter', 'category-filter', 'date-from-filter', 'date-to-filter'].forEach(id => {
        if ($(`#${id}`)) $(`#${id}`).value = '';
      });
      $('#admin-sort-filter').value = 'newest';
      adminPage = 1;
      await loadAdminComplaints();
    }

    const shortcut = event.target.closest('[data-status-shortcut]');
    if (shortcut) {
      $('#status-filter').value = shortcut.dataset.statusShortcut;
      adminPage = 1;
      await loadAdminComplaints();
    }

    const star = event.target.closest('[data-star]');
    if (star) {
      const val = star.dataset.star;
      $('#rating-input').value = val;
      $$('#star-picker span').forEach((s, idx) => {
        s.classList.toggle('active', idx < val);
      });
    }

    const copyBtn = event.target.closest('[data-copy-tracking]');
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copyTracking);
        toast('Tracking number copied to clipboard.');
      } catch {
        toast(`Tracking number: ${copyBtn.dataset.copyTracking}`);
      }
    }

    const card = event.target.closest('[data-complaint-id]');
    if (card) {
      await openComplaint(card.dataset.complaintId, card.dataset.admin === 'true');
    }
  } catch (err) {
    toast(err.message);
  }
});

// Forms & Submissions
const loginForm = $('#login-form');
if (loginForm) {
  const emailInput = $('#email', loginForm);
  const rememberEmail = $('#remember-email', loginForm);
  try {
    const savedEmail = localStorage.getItem('sbu-remembered-email');
    if (savedEmail && emailInput) {
      emailInput.value = savedEmail;
      rememberEmail.checked = true;
    }
  } catch { /* Browser storage may be disabled. */ }

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    formMessage(form, '');
    const values = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const data = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: values.email, password: values.password }) });
      try {
        if (rememberEmail.checked) localStorage.setItem('sbu-remembered-email', values.email);
        else localStorage.removeItem('sbu-remembered-email');
      } catch { /* Browser storage may be disabled. */ }
      window.location.assign(routeFor(data.user));
    } catch (err) {
      formMessage(form, err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

const registerForm = $('#register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    formMessage(form, '');
    const values = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const data = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(values) });
      window.location.assign(routeFor(data.user));
    } catch (err) {
      formMessage(form, err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

const complaintForm = $('#complaint-form');
if (complaintForm) {
  const descEl = complaintForm.elements.description;
  if (descEl) {
    descEl.addEventListener('input', e => {
      const counter = $('#description-counter');
      if (counter) counter.textContent = `${e.currentTarget.value.length} / 4000`;
    });
  }

  // Category auto-department preview hint
  const catEl = complaintForm.elements.category;
  if (catEl) {
    catEl.addEventListener('change', e => {
      const hint = $('#dept-hint');
      if (!hint) return;
      const cat = e.currentTarget.value;
      let dept = 'General Support';
      if (cat === 'Facilities' || cat === 'Furniture') dept = 'Facilities & Estate';
      else if (cat === 'Electrical') dept = 'Electrical Maintenance';
      else if (cat === 'Cleanliness') dept = 'Housekeeping & Sanitation';
      else if (cat === 'Internet / IT') dept = 'IT Infrastructure';
      else if (cat === 'Safety') dept = 'Campus Security';
      hint.textContent = cat ? `Routes to: ${dept}` : '';
    });
  }

  complaintForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    formMessage(form, '');
    const values = Object.fromEntries(new FormData(form));
    values.anonymous = form.elements.anonymous ? form.elements.anonymous.checked : false;
    values.image = $('#image-data-url')?.value || null;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const data = await request('/api/complaints', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      const counter = $('#description-counter');
      if (counter) counter.textContent = '0 / 4000';
      const preview = $('#image-preview');
      if (preview) preview.style.display = 'none';
      const hiddenImg = $('#image-data-url');
      if (hiddenImg) hiddenImg.value = '';
      const deptHint = $('#dept-hint');
      if (deptHint) deptHint.textContent = '';
      studentPage = 1;
      formMessage(form, `Grievance submitted successfully! Tracking Code: ${data.trackingCode}`, true);
      toast(`Grievance submitted! Tracking Code: ${data.trackingCode}`);
      await loadStudentComplaints();
    } catch (err) {
      formMessage(form, err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// Detail Dialog form event delegation (Admin status update, Student feedback & reopen)
const detailContent = $('#detail-content');
if (detailContent) {
  detailContent.addEventListener('submit', async e => {
    e.preventDefault();
    const target = e.target;

    if (target.id === 'admin-status-form') {
      const values = Object.fromEntries(new FormData(target));
      const btn = target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await request(`/api/admin/complaints/${currentAdminDetailId}/status`, { method: 'PATCH', body: JSON.stringify(values) });
        toast('Complaint updated successfully.');
        await openComplaint(currentAdminDetailId, true);
        await loadAdminComplaints();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    } else if (target.id === 'student-feedback-form') {
      const values = Object.fromEntries(new FormData(target));
      const btn = target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await request(`/api/complaints/${currentStudentDetailId}/feedback`, { method: 'POST', body: JSON.stringify(values) });
        toast('Thank you for your rating!');
        $('#detail-dialog').close();
        await loadStudentComplaints();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    } else if (target.id === 'student-reopen-form') {
      const values = Object.fromEntries(new FormData(target));
      values.reopen = true;
      const btn = target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await request(`/api/complaints/${currentStudentDetailId}/feedback`, { method: 'POST', body: JSON.stringify(values) });
        toast('Complaint reopened for review.');
        $('#detail-dialog').close();
        await loadStudentComplaints();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    }
  });
}

// Search and Filter Listeners
if ($('#admin-search')) {
  let searchTimer;
  const resetAdmin = () => { adminPage = 1; loadAdminComplaints().catch(err => toast(err.message)); };
  $('#admin-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(resetAdmin, 250); });
  ['status-filter', 'priority-filter', 'location-filter', 'category-filter', 'admin-sort-filter'].forEach(id => {
    if ($(`#${id}`)) $(`#${id}`).addEventListener('change', resetAdmin);
  });
  $('#date-from-filter')?.addEventListener('change', () => {
    $('#date-to-filter').min = $('#date-from-filter').value;
    resetAdmin();
  });
  $('#date-to-filter')?.addEventListener('change', resetAdmin);
}

if ($('#student-search')) {
  let searchTimer;
  const resetStudent = () => { studentPage = 1; loadStudentComplaints().catch(err => toast(err.message)); };
  $('#student-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(resetStudent, 250); });
  $('#student-status-filter')?.addEventListener('change', resetStudent);
}

// Initialization on Load
(async () => {
  initTheme();
  setupImageUpload();
  try {
    const csrf = await request('/api/csrf-token');
    csrfToken = csrf.token;
    const page = document.body.dataset.page;
    if (page === 'login' || page === 'register') {
      await request('/api/me').then(({ user }) => {
        if (user) window.location.replace(routeFor(user));
      }).catch(() => {});
    } else if (page === 'home') {
      await request('/api/me').then(({ user }) => {
        if (user) {
          const navAction = $('.top-nav a.button');
          if (navAction) {
            navAction.href = routeFor(user);
            navAction.textContent = 'Go to Dashboard →';
          }
          const signinLink = $('.nav-link[href="/login.html"]');
          if (signinLink) signinLink.style.display = 'none';
        }
      }).catch(() => {});
    } else if (page === 'student') {
      const { user } = await request('/api/me');
      if (!user || user.role !== 'student') { window.location.replace('/login.html'); return; }
      document.documentElement.classList.remove('auth-check-pending');
      $('#student-greeting').textContent = `Welcome, ${user.name}`;
      await loadStudentComplaints();
    } else if (page === 'admin') {
      const { user } = await request('/api/me');
      if (!user || user.role !== 'admin') { window.location.replace('/login.html'); return; }
      document.documentElement.classList.remove('auth-check-pending');
      await loadAdminComplaints();
    }
  } catch (err) {
    const page = document.body.dataset.page;
    if (['admin', 'student'].includes(page)) window.location.replace('/login.html');
  }
})();
