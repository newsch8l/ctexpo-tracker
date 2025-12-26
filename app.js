/* CT-expo MVP Tracker — GitHub Pages frontend
   Connects to Google Apps Script Web App.
   Configure in localStorage:
   - CT_API_URL: your Apps Script Web App URL
   - CT_API_TOKEN: shared token (optional but recommended)
*/

const STATUSES = ["Очередь","Готово к запуску","Делаем","На стопе","Готово"];

const els = {
  board: document.getElementById("board"),
  q: document.getElementById("q"),
  workcenter: document.getElementById("workcenter"),
  assignee: document.getElementById("assignee"),
  refresh: document.getElementById("refresh"),
  archiveToggle: document.getElementById("archiveToggle"),
  newTask: document.getElementById("newTask"),
  conn: document.getElementById("conn"),
  count: document.getElementById("count"),
  overdue: document.getElementById("overdue"),
  blocked: document.getElementById("blocked"),
  archiveCount: document.getElementById("archiveCount"),
  toast: document.getElementById("toast"),
  modal: document.getElementById("modal"),
  form: document.getElementById("form"),
  subtitle: document.getElementById("subtitle"),
};

let state = {
  tasks: [],
  filtered: [],
  draggingId: null,
  mode: "board", // board | archive
  archiveTotal: 0,
};

function toast(msg){
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  setTimeout(()=>els.toast.classList.remove("show"), 2200);
}

function getApi(){
  const url = localStorage.getItem("CT_API_URL") || "";
  const token = localStorage.getItem("CT_API_TOKEN") || "";
  return { url, token };
}

function needConfig(){
  const { url } = getApi();
  return !url;
}

async function apiGetTasks(){
  const { url, token } = getApi();
  const u = new URL(url);
  u.searchParams.set("action","tasks");
  if (token) u.searchParams.set("token", token);
  const r = await fetch(u.toString(), { method: "GET" });
  if (!r.ok) throw new Error("API error: " + r.status);
  const data = await r.json();
  if (!data || !Array.isArray(data.tasks)) throw new Error("Bad payload");
  return data.tasks;
}

async function apiGetArchiveTasks(){
  const { url, token } = getApi();
  const u = new URL(url);
  u.searchParams.set("action","archive_tasks");
  if (token) u.searchParams.set("token", token);
  const r = await fetch(u.toString(), { method: "GET" });
  if (!r.ok) throw new Error("API error: " + r.status);
  const data = await r.json();
  if (!data || !Array.isArray(data.tasks)) throw new Error("Bad payload");
  return data.tasks;
}

async function apiRestoreTask(taskId){
  const { url, token } = getApi();
  const body = { action: "restore", token, task_id: taskId };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data || data.ok !== true) throw new Error(data?.error || "Restore failed");
  return true;
}

async function apiUpsertTask(task){
  const { url, token } = getApi();
  const body = { action: "upsert", token, task };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script friendly
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data || data.ok !== true) throw new Error(data?.error || "Update failed");
  return data.task;
}

async function apiArchiveTask(taskId){
  const { url, token } = getApi();
  const body = { action: "archive", token, task_id: taskId };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data || data.ok !== true) throw new Error(data?.error || "Archive failed");
  return true;
}

async function apiDeleteTask(taskId, from){
  const { url, token } = getApi();
  const body = { action: "delete", token, task_id: taskId, from: from || "tasks" };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data || data.ok !== true) throw new Error(data?.error || "Delete failed");
  return true;
}

function normalizeTask(t){
  const n = (v)=> (v === undefined || v === null) ? "" : String(v);
  const num = (v)=> {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    task_id: n(t.task_id),
    order_id: n(t.order_id),
    item: n(t.item),
    operation: n(t.operation),
    workcenter: n(t.workcenter),
    status: STATUSES.includes(n(t.status)) ? n(t.status) : "Очередь",
    assignee: n(t.assignee),
    priority: ["P1","P2","P3"].includes(n(t.priority)) ? n(t.priority) : "P2",
    due_date: n(t.due_date), // yyyy-mm-dd
    planned_min: num(t.planned_min),
    done_min: num(t.done_min),
    note: n(t.note),
    updated_at: n(t.updated_at),
  };
}

function applyFilters(){
  const q = (els.q.value || "").trim().toLowerCase();
  const wc = els.workcenter.value;
  const asg = els.assignee.value;

  const ok = (t)=>{
    if (wc && t.workcenter !== wc) return false;
    if (asg && t.assignee !== asg) return false;
    if (!q) return true;
    const s = (t.order_id + " " + t.item + " " + t.operation + " " + t.workcenter + " " + t.assignee + " " + t.note).toLowerCase();
    return s.includes(q);
  };

  state.filtered = state.tasks.filter(ok);
}

function isOverdue(t){
  if (!t.due_date) return false;
  if (t.status === "Готово") return false;
  const d = new Date(t.due_date + "T00:00:00");
  const today = new Date();
  today.setHours(0,0,0,0);
  return d < today;
}

function pctDone(t){
  if (!t.planned_min) return 0;
  const p = Math.max(0, Math.min(1, (t.done_min || 0) / t.planned_min));
  return Math.round(p * 100);
}

function statusDotClass(t){
  if (t.status === "На стопе") return "dot blocked";
  if (t.status === "Готово") return "dot done";
  if (t.priority === "P1") return "dot p1";
  return "dot";
}


function renderArchive(){
  applyFilters();

  els.count.textContent = String(state.filtered.length);
  els.overdue.textContent = "0";
  els.blocked.textContent = "0";

  const wcs = Array.from(new Set(state.tasks.map(t=>t.workcenter).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ru"));
  const asgs = Array.from(new Set(state.tasks.map(t=>t.assignee).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ru"));
  fillSelect(els.workcenter, wcs, "Все участки");
  fillSelect(els.assignee, asgs, "Все исполнители");

  els.board.innerHTML = "";
  const col = document.createElement("section");
  col.className = "col";
  const head = document.createElement("div");
  head.className = "col-head";
  head.innerHTML = '<div class="col-title"><span>Архив</span> <span class="badge">'+state.filtered.length+'</span></div>';
  const body = document.createElement("div");
  body.className = "col-body";

  const list = state.filtered
    .slice()
    .sort((a,b)=> (b.updated_at||"").localeCompare(a.updated_at||"") || a.order_id.localeCompare(b.order_id,"ru"));

  for (const t of list){
    body.appendChild(renderArchiveCard(t));
  }

  col.appendChild(head);
  col.appendChild(body);
  els.board.appendChild(col);
}

function renderArchiveCard(t){
  const card = renderCard(t);
  const actions = card.querySelector(".card-actions");
  if (actions){
    const keep = actions.querySelector("button");
    actions.innerHTML = "";
    if (keep) actions.appendChild(keep);

    const restore = document.createElement("button");
    restore.className = "link";
    restore.type = "button";
    restore.textContent = "Восстановить";
    restore.addEventListener("click", async ()=>{
      if (!t.task_id) return;
      if (!confirm("Вернуть задачу из архива обратно в доску?")) return;
      try{
        await apiRestoreTask(t.task_id);
        toast("Возвращено в доску");
        await reload();
      }catch(err){
        console.error(err);
        toast("Не удалось восстановить");
      }
    });

    const del = document.createElement("button");
    del.className = "link link-danger";
    del.type = "button";
    del.textContent = "Удалить";
    del.addEventListener("click", async ()=>{
      if (!t.task_id) return;
      if (!confirm("Удалить задачу НАВСЕГДА? Это действие нельзя отменить.")) return;
      try{
        await apiDeleteTask(t.task_id, "archive");
        toast("Удалено");
        await reload();
      }catch(err){
        console.error(err);
        toast("Не удалось удалить");
      }
    });

    actions.appendChild(restore);
    actions.appendChild(del);
  }
  return card;
}

function render(){
  if (state.mode === "archive"){
    return renderArchive();
  }

  applyFilters();

  // stats
  els.count.textContent = String(state.filtered.length);
  els.overdue.textContent = String(state.filtered.filter(isOverdue).length);
  els.blocked.textContent = String(state.filtered.filter(t=>t.status==="На стопе").length);

  // filters options
  const wcs = Array.from(new Set(state.tasks.map(t=>t.workcenter).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ru"));
  const asgs = Array.from(new Set(state.tasks.map(t=>t.assignee).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ru"));
  fillSelect(els.workcenter, wcs, "Все участки");
  fillSelect(els.assignee, asgs, "Все исполнители");

  // columns
  els.board.innerHTML = "";
  for (const st of STATUSES){
    const col = document.createElement("section");
    col.className = "col";
    col.dataset.status = st;

    const head = document.createElement("div");
    head.className = "col-head";
    const title = document.createElement("div");
    title.className = "col-title";
    title.innerHTML = `<span>${st}</span> <span class="badge">${state.filtered.filter(t=>t.status===st).length}</span>`;
    head.appendChild(title);

    const body = document.createElement("div");
    body.className = "col-body";
    body.addEventListener("dragover", (e)=>{ e.preventDefault(); body.style.outline = "1px dashed rgba(255,255,255,.18)"; });
    body.addEventListener("dragleave", ()=>{ body.style.outline = ""; });
    body.addEventListener("drop", async (e)=>{
      e.preventDefault();
      body.style.outline = "";
      if (!state.draggingId) return;
      const t = state.tasks.find(x=>x.task_id===state.draggingId);
      if (!t) return;
      if (t.status === st) return;
      const before = t.status;
      t.status = st;
      try{
        await apiUpsertTask(t);
        toast(`Статус: ${before} → ${st}`);
        await reload();
      }catch(err){
        toast("Не удалось обновить статус");
        console.error(err);
        t.status = before;
        render();
      }
    });

    const list = state.filtered
      .filter(t=>t.status===st)
      .sort((a,b)=>{
        // Priority then due date then order
        const pr = (x)=> x.priority === "P1" ? 1 : x.priority === "P2" ? 2 : 3;
        const da = a.due_date ? a.due_date : "9999-99-99";
        const db = b.due_date ? b.due_date : "9999-99-99";
        return pr(a)-pr(b) || da.localeCompare(db) || a.order_id.localeCompare(b.order_id,"ru");
      });

    for (const t of list){
      body.appendChild(renderCard(t));
    }

    col.appendChild(head);
    col.appendChild(body);
    els.board.appendChild(col);
  }
}

function fillSelect(sel, items, placeholder){
  const cur = sel.value;
  const keep = new Set(["", ...items]);
  // rebuild only if options differ
  const existing = Array.from(sel.options).map(o=>o.value);
  const desired = ["", ...items];
  const same = existing.length === desired.length && existing.every((v,i)=>v===desired[i]);
  if (same) return;

  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder;
  sel.appendChild(o0);
  for (const it of items){
    const o = document.createElement("option");
    o.value = it;
    o.textContent = it;
    sel.appendChild(o);
  }
  if (keep.has(cur)) sel.value = cur;
}

function renderCard(t){
  const card = document.createElement("article");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = t.task_id;

  card.addEventListener("dragstart", ()=>{
    state.draggingId = t.task_id;
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", ()=>{
    state.draggingId = null;
    card.classList.remove("dragging");
  });

  const top = document.createElement("div");
  top.className = "card-top";

  const left = document.createElement("div");
  left.innerHTML = `
    <div class="kicker">Наряд <b>${escapeHtml(t.order_id || "—")}</b> · <span class="small">${escapeHtml(t.workcenter || "—")}</span></div>
    <div class="h1">${escapeHtml(t.operation || "—")}</div>
    <div class="small">${escapeHtml(t.item || "")}</div>
  `;

  const right = document.createElement("div");
  const overdue = isOverdue(t);
  const pr = t.priority || "P2";
  right.innerHTML = `
    <div class="row" style="justify-content:flex-end">
      <div class="${statusDotClass(t)}" title="${escapeHtml(pr + (overdue ? " · просрочено" : ""))}"></div>
      <div class="badge" title="Приоритет">${escapeHtml(pr)}</div>
    </div>
  `;

  top.appendChild(left);
  top.appendChild(right);

  const meta = document.createElement("div");
  meta.className = "row";
  const due = t.due_date ? t.due_date : "—";
  const asg = t.assignee ? t.assignee : "—";
  const plan = t.planned_min ? `${t.planned_min} мин` : "—";
  const done = t.done_min ? `${t.done_min} мин` : "—";
  meta.innerHTML = `
    <div class="kv"><span class="small">Исп.: <b>${escapeHtml(asg)}</b></span></div>
    <div class="kv"><span class="small">Дедлайн: <b>${escapeHtml(due)}</b></span></div>
    <div class="kv"><span class="small">План/факт: <b>${escapeHtml(plan)}</b> / <b>${escapeHtml(done)}</b></span></div>
  `;

  const p = pctDone(t);
  const prog = document.createElement("div");
  prog.className = "progress";
  prog.innerHTML = `<i style="width:${p}%"></i>`;

  const note = document.createElement("div");
  note.className = "small";
  note.style.marginTop = "8px";
  note.textContent = (t.note || "").slice(0, 160);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const edit = document.createElement("button");
  edit.className = "link";
  edit.type = "button";
  edit.textContent = "Открыть";
  edit.addEventListener("click", ()=> openModal(t));

  actions.appendChild(edit);

  const archive = document.createElement("button");
  archive.className = "link link-muted";
  archive.type = "button";
  archive.textContent = "Архив";
  archive.addEventListener("click", async ()=>{
    if (!t.task_id) return;
    if (!confirm("Отправить задачу в архив? Она исчезнет из доски и появится на листе Archive.")) return;
    try{
      await apiArchiveTask(t.task_id);
      toast("В архиве");
      await reload();
    }catch(err){
      console.error(err);
      toast("Не удалось архивировать");
    }
  });

  const del = document.createElement("button");
  del.className = "link link-danger";
  del.type = "button";
  del.textContent = "Удалить";
  del.addEventListener("click", async ()=>{
    if (!t.task_id) return;
    if (!confirm("Удалить задачу НАВСЕГДА? Это действие нельзя отменить.")) return;
    try{
      await apiDeleteTask(t.task_id, "tasks");
      toast("Удалено");
      await reload();
    }catch(err){
      console.error(err);
      toast("Не удалось удалить");
    }
  });

  actions.appendChild(archive);
  actions.appendChild(del);

  card.appendChild(top);
  card.appendChild(meta);
  card.appendChild(prog);
  if (t.note) card.appendChild(note);
  card.appendChild(actions);

  return card;
}

function openModal(t){
  const f = els.form;
  f.task_id.value = t.task_id || "";
  f.order_id.value = t.order_id || "";
  f.item.value = t.item || "";
  f.operation.value = t.operation || "";
  f.workcenter.value = t.workcenter || "";
  f.status.value = t.status || "Очередь";
  f.assignee.value = t.assignee || "";
  f.priority.value = t.priority || "P2";
  f.due_date.value = t.due_date || "";
  f.planned_min.value = String(t.planned_min || "");
  f.done_min.value = String(t.done_min || "");
  f.note.value = t.note || "";

  document.getElementById("modalTitle").textContent = t.task_id ? "Задача" : "Новая задача";
  document.getElementById("modalSub").textContent = t.task_id ? ("ID: " + t.task_id) : "Создать";

  els.modal.showModal();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function serializeForm(){
  const fd = new FormData(els.form);
  const obj = {};
  for (const [k,v] of fd.entries()) obj[k] = (v || "").toString().trim();
  obj.planned_min = Number(obj.planned_min || 0);
  obj.done_min = Number(obj.done_min || 0);
  // Normalize empty dates
  if (!obj.due_date) obj.due_date = "";
  // If creating and no id, leave blank: API will generate
  return obj;
}

async function saveFromModal(){
  const t = serializeForm();
  // minimal validation
  if (!t.order_id || !t.operation || !t.workcenter){
    toast("Заполни: Наряд, Операция, Участок");
    return;
  }

  try{
    await apiUpsertTask(t);
    toast("Сохранено");
    els.modal.close();
    await reload();
  }catch(err){
    console.error(err);
    toast("Не удалось сохранить (проверь API/доступ)");
  }
}

async function reload(){
  if (needConfig()){
    els.conn.textContent = "нужен API_URL";
    renderEmpty();
    return;
  }
  try{
    els.conn.textContent = "подключение…";
    const tasks = await apiGetTasks();
    state.tasks = tasks.map(normalizeTask);
    els.conn.textContent = "ок";
    render();
  }catch(err){
    console.error(err);
    els.conn.textContent = "ошибка";
    renderEmpty("Не удалось загрузить задачи. Проверь Apps Script URL/доступ.");
  }
}

function renderEmpty(msg){
  els.board.innerHTML = "";
  els.count.textContent = "0";
  els.overdue.textContent = "0";
  els.blocked.textContent = "0";
  for (const st of STATUSES){
    const col = document.createElement("section");
    col.className = "col";
    const head = document.createElement("div");
    head.className = "col-head";
    head.innerHTML = `<div class="col-title"><span>${st}</span> <span class="badge">0</span></div>`;
    const body = document.createElement("div");
    body.className = "col-body";
    const hint = document.createElement("div");
    hint.className = "small";
    hint.style.color = "rgba(224,224,224,.65)";
    hint.style.padding = "8px";
    hint.textContent = msg || "Настрой API: открой DevTools → Application → Local Storage и добавь CT_API_URL.";
    body.appendChild(hint);
    col.appendChild(head);
    col.appendChild(body);
    els.board.appendChild(col);
  }
}

function setupConfigHint(){
  const { url } = getApi();
  els.subtitle.textContent = url ? "MVP на Google Sheets" : "Нужна настройка API_URL";
}

els.q.addEventListener("input", ()=>render());
els.workcenter.addEventListener("change", ()=>render());
els.assignee.addEventListener("change", ()=>render());
els.refresh.addEventListener("click", ()=>reload());

els.archiveToggle?.addEventListener("click", async ()=>{
  state.mode = (state.mode === "board") ? "archive" : "board";
  await reload();
});

els.newTask.addEventListener("click", ()=>{
  openModal(normalizeTask({ task_id:"", status:"Очередь", priority:"P2" }));
});

els.form.addEventListener("submit", (e)=>{
  e.preventDefault();
  saveFromModal();
});

window.addEventListener("keydown", (e)=>{
  if (e.key === "Escape" && els.modal.open) els.modal.close();
});

setupConfigHint();
// Modal close buttons (must bypass form validation)
const closeModalBtn = document.getElementById("closeModal");
const cancelModalBtn = document.getElementById("cancelModal");
if (closeModalBtn) closeModalBtn.addEventListener("click", () => els.modal.close());
if (cancelModalBtn) cancelModalBtn.addEventListener("click", () => els.modal.close());

// Allow native ESC to close without validation
els.modal.addEventListener("cancel", (e) => {
  e.preventDefault();
  els.modal.close();
});

reload();
