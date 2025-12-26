/**
 * CT-expo MVP Tracker — Google Apps Script Web App
 * Acts as a tiny JSON API for the GitHub Pages frontend.
 *
 * 1) Put your Spreadsheet ID into SPREADSHEET_ID
 * 2) Set a TOKEN (shared secret) — recommended
 * 3) Deploy as Web App: Execute as "Me", Who has access "Anyone" (or "Anyone with link" depending on your setup)
 *
 * Endpoints:
 * - GET  ?action=tasks&token=...
 * - GET  ?action=archive_tasks&token=...
 * - POST {action:"upsert", token:"...", task:{...}}
 */

const SPREADSHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";
const TASKS_SHEET_NAME = "Tasks";
const WORKLOG_SHEET_NAME = "Worklog";
const ARCHIVE_SHEET_NAME = "Archive";
const TOKEN = "CHANGE_ME_TOKEN"; // set empty string to disable token check

function _json(o){
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function _deny(msg){
  return _json({ ok:false, error: msg || "denied" });
}

function _checkToken(token){
  if (!TOKEN) return true;
  return String(token || "") === String(TOKEN);
}

function _ss(){
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function _sheet(name){
  const sh = _ss().getSheetByName(name);
  if (!sh) throw new Error("Missing sheet: " + name);
  return sh;
}

function _headers(sh){
  const rng = sh.getRange(1,1,1,sh.getLastColumn());
  const vals = rng.getValues()[0];
  return vals.map(String);
}

function _rowToObj(headers, row){
  const o = {};
  for (let i=0;i<headers.length;i++){
    o[headers[i]] = row[i];
  }
  return o;
}


function _findRowByTaskId(sh, headers, taskId){
  const idxId = headers.indexOf("task_id");
  if (idxId < 0) throw new Error("Missing header: task_id");
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, idxId+1, lastRow-1, 1).getValues().flat().map(v=>String(v||""));
  const pos = ids.indexOf(String(taskId||""));
  return pos >= 0 ? (2 + pos) : -1;
}

function _ensureArchiveSheet(headers){
  const ss = _ss();
  let sh = ss.getSheetByName(ARCHIVE_SHEET_NAME);
  if (!sh){
    sh = ss.insertSheet(ARCHIVE_SHEET_NAME);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    return sh;
  }
  // If empty, set headers
  if (sh.getLastRow() < 1){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function _nowISO(){
  return new Date().toISOString();
}

function _genId(){
  // short-ish unique id
  return Utilities.getUuid().slice(0, 8);
}

function doGet(e){
  try{
    const action = (e.parameter.action || "").toString();
    const token = (e.parameter.token || "").toString();

    if (!_checkToken(token)) return _deny("bad token");

    if (action === "tasks"){
      const sh = _sheet(TASKS_SHEET_NAME);
      const headers = _headers(sh);

      const lastRow = sh.getLastRow();
      if (lastRow < 2){
        return _json({ ok:true, tasks: [] });
      }
      const data = sh.getRange(2,1,lastRow-1,headers.length).getValues();
      const tasks = data
        .filter(r => r.join("").toString().trim() !== "")
        .map(r => _rowToObj(headers, r))
        .map(t => {
          // normalize dates/numbers for frontend
          if (t.due_date instanceof Date){
            t.due_date = Utilities.formatDate(t.due_date, Session.getScriptTimeZone(), "yyyy-MM-dd");
          }else{
            t.due_date = (t.due_date || "").toString();
          }
          t.planned_min = Number(t.planned_min || 0);
          t.done_min = Number(t.done_min || 0);
          t.task_id = (t.task_id || "").toString();
          t.updated_at = (t.updated_at || "").toString();
          return t;
        });

      return _json({ ok:true, tasks });
    }

    
    if (action === "archive_tasks"){
      const ss = _ss();
      const sh = ss.getSheetByName(ARCHIVE_SHEET_NAME);
      if (!sh) return _json({ ok:true, tasks: [] });

      const headers = _headers(sh);
      const lastRow = sh.getLastRow();
      if (lastRow < 2){
        return _json({ ok:true, tasks: [] });
      }

      const data = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
      const tasks = data
        .filter(r => r.join("").toString().trim() !== "")
        .map(r => _rowToObj(headers, r))
        .map(t => {
          if (t.due_date instanceof Date){
            t.due_date = Utilities.formatDate(t.due_date, Session.getScriptTimeZone(), "yyyy-MM-dd");
          }else{
            t.due_date = (t.due_date || "").toString();
          }
          t.planned_min = Number(t.planned_min || 0);
          t.done_min = Number(t.done_min || 0);
          t.task_id = (t.task_id || "").toString();
          t.updated_at = (t.updated_at || "").toString();
          return t;
        });

      return _json({ ok:true, tasks });
    }

    return _deny("unknown action");
  }catch(err){
    return _json({ ok:false, error: String(err) });
  }
}

function doPost(e){
  try{
    const payload = JSON.parse(e.postData.contents || "{}");
    const action = (payload.action || "").toString();
    const token = (payload.token || "").toString();

    if (!_checkToken(token)) return _deny("bad token");

    
    if (action === "archive"){
      const taskId = (payload.task_id || payload.task?.task_id || "").toString().trim();
      if (!taskId) throw new Error("task_id required");

      const sh = _sheet(TASKS_SHEET_NAME);
      const headers = _headers(sh);
      const rowNum = _findRowByTaskId(sh, headers, taskId);
      if (rowNum < 0) throw new Error("task not found");

      const row = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      const arch = _ensureArchiveSheet(headers);
      // stamp archived_at if column exists, else keep as-is
      arch.appendRow(row);
      sh.deleteRow(rowNum);

      const updatedAt = _nowISO();
      const wl = _ss().getSheetByName(WORKLOG_SHEET_NAME);
      if (wl){
        wl.appendRow([updatedAt, taskId, action, "archived"]);
      }
      return _json({ ok:true });
    }

    if (action === "restore"){
      const taskId = (payload.task_id || payload.task?.task_id || "").toString().trim();
      if (!taskId) throw new Error("task_id required");

      const ss = _ss();
      const arch = ss.getSheetByName(ARCHIVE_SHEET_NAME);
      if (!arch) throw new Error("Archive sheet missing");

      const aHeaders = _headers(arch);
      const aRowNum = _findRowByTaskId(arch, aHeaders, taskId);
      if (aRowNum < 0) throw new Error("task not found in archive");

      const row = arch.getRange(aRowNum, 1, 1, aHeaders.length).getValues()[0];
      const rowObj = _rowToObj(aHeaders, row);

      const tasksSh = _sheet(TASKS_SHEET_NAME);
      const tHeaders = _headers(tasksSh);
      const newRow = tHeaders.map(h => (rowObj[h] === undefined) ? "" : rowObj[h]);

      tasksSh.appendRow(newRow);
      arch.deleteRow(aRowNum);

      const updatedAt = _nowISO();
      const wl = ss.getSheetByName(WORKLOG_SHEET_NAME);
      if (wl){
        wl.appendRow([updatedAt, taskId, action, "restored"]);
      }
      return _json({ ok:true });
    }

    if (action === "delete"){
      const taskId = (payload.task_id || payload.task?.task_id || "").toString().trim();
      const from = (payload.from || "tasks").toString(); // "tasks" | "archive"
      if (!taskId) throw new Error("task_id required");

      const sheetName = (from === "archive") ? ARCHIVE_SHEET_NAME : TASKS_SHEET_NAME;
      const sh = _ss().getSheetByName(sheetName);
      if (!sh) throw new Error("Missing sheet: " + sheetName);

      const headers = _headers(sh);
      const rowNum = _findRowByTaskId(sh, headers, taskId);
      if (rowNum < 0) throw new Error("task not found");
      sh.deleteRow(rowNum);

      const updatedAt = _nowISO();
      const wl = _ss().getSheetByName(WORKLOG_SHEET_NAME);
      if (wl){
        wl.appendRow([updatedAt, taskId, action, "deleted:" + from]);
      }
      return _json({ ok:true });
    }


    if (action === "upsert"){
      const t = payload.task || {};
      const sh = _sheet(TASKS_SHEET_NAME);
      const headers = _headers(sh);
      const idx = {};
      headers.forEach((h,i)=> idx[h]=i);

      // Ensure required headers exist
      const need = ["task_id","order_id","item","operation","workcenter","status","assignee","priority","due_date","planned_min","done_min","note","updated_at"];
      need.forEach(h=>{
        if (!(h in idx)) throw new Error("Missing header: " + h);
      });

      let taskId = (t.task_id || "").toString().trim();
      if (!taskId) taskId = _genId();

      // Find existing row
      const lastRow = sh.getLastRow();
      let rowNum = -1;
      if (lastRow >= 2){
        const ids = sh.getRange(2, idx["task_id"]+1, lastRow-1, 1).getValues().flat().map(v=>String(v||""));
        const pos = ids.indexOf(taskId);
        if (pos >= 0) rowNum = 2 + pos;
      }

      const updatedAt = _nowISO();

      // Build row values with current values if updating
      let row = new Array(headers.length).fill("");
      if (rowNum > 0){
        row = sh.getRange(rowNum,1,1,headers.length).getValues()[0];
      }

      function setField(name, value){
        row[idx[name]] = value;
      }

      setField("task_id", taskId);
      setField("order_id", (t.order_id || "").toString().trim());
      setField("item", (t.item || "").toString().trim());
      setField("operation", (t.operation || "").toString().trim());
      setField("workcenter", (t.workcenter || "").toString().trim());
      setField("status", (t.status || "Backlog").toString().trim());
      setField("assignee", (t.assignee || "").toString().trim());
      setField("priority", (t.priority || "P2").toString().trim());

      // date: store as date or string; we'll store string for simplicity
      setField("due_date", (t.due_date || "").toString().trim());

      setField("planned_min", Number(t.planned_min || 0));
      setField("done_min", Number(t.done_min || 0));
      setField("note", (t.note || "").toString());
      setField("updated_at", updatedAt);

      if (rowNum > 0){
        sh.getRange(rowNum,1,1,headers.length).setValues([row]);
      }else{
        sh.appendRow(row);
        rowNum = sh.getLastRow();
      }

      // Optional: write worklog
      const wl = _ss().getSheetByName(WORKLOG_SHEET_NAME);
      if (wl){
        wl.appendRow([updatedAt, taskId, action, JSON.stringify({ status: t.status, done_min: t.done_min })]);
      }

      return _json({ ok:true, task: { task_id: taskId, updated_at: updatedAt }});
    }

    
    if (action === "archive_tasks"){
      const ss = _ss();
      const sh = ss.getSheetByName(ARCHIVE_SHEET_NAME);
      if (!sh) return _json({ ok:true, tasks: [] });

      const headers = _headers(sh);
      const lastRow = sh.getLastRow();
      if (lastRow < 2){
        return _json({ ok:true, tasks: [] });
      }

      const data = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
      const tasks = data
        .filter(r => r.join("").toString().trim() !== "")
        .map(r => _rowToObj(headers, r))
        .map(t => {
          if (t.due_date instanceof Date){
            t.due_date = Utilities.formatDate(t.due_date, Session.getScriptTimeZone(), "yyyy-MM-dd");
          }else{
            t.due_date = (t.due_date || "").toString();
          }
          t.planned_min = Number(t.planned_min || 0);
          t.done_min = Number(t.done_min || 0);
          t.task_id = (t.task_id || "").toString();
          t.updated_at = (t.updated_at || "").toString();
          return t;
        });

      return _json({ ok:true, tasks });
    }

    return _deny("unknown action");
  }catch(err){
    return _json({ ok:false, error: String(err) });
  }
}
