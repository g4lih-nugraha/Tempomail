let currentEmail = localStorage.getItem('sann404_mail') || null;
let db; 
let currentOpenMsgData = null;

const DB_NAME = 'SannMailDB';
const DB_VERSION = 2; 
const STORE_MSG = 'messages';
const STORE_DELETED = 'deleted_ids'; 

document.addEventListener('DOMContentLoaded', async () => {
    await initDB();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW Fail:', err));
    }

    if (currentEmail) {
        document.getElementById('emailAddress').innerText = currentEmail;
        await loadCachedMessages(); 
        fetchInbox(); 
    } else {
        generateNewEmail();
    }

    startAutoRefresh();
});

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_MSG)) db.createObjectStore(STORE_MSG, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_DELETED)) db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => reject(e);
    });
}

async function clearInbox() {
    if(confirm('Hapus semua pesan dari penyimpanan?')) {
        const msgs = await getAllMessagesFromDB();
        const tx = db.transaction([STORE_MSG, STORE_DELETED], 'readwrite');
        const storeMsg = tx.objectStore(STORE_MSG);
        const storeDel = tx.objectStore(STORE_DELETED);
        msgs.forEach(m => {
            storeDel.put({ id: m.id });
            storeMsg.delete(m.id);
        });
        tx.oncomplete = () => {
            renderMessages([]); 
            updateBadge(0);
        };
    }
}

async function generateNewEmail() {
    const emailDisplay = document.getElementById('emailAddress');
    emailDisplay.innerText = "Membuat ID baru...";

    const tx = db.transaction([STORE_MSG, STORE_DELETED], 'readwrite');
    tx.objectStore(STORE_MSG).clear();
    tx.objectStore(STORE_DELETED).clear();
    updateBadge(0);

    try {
        // DISINI PERUBAHANNYA: Mengarah ke /api/api
        const res = await fetch('/api/api?action=generate');
        const data = await res.json();

        if (data.success) {
            currentEmail = data.result.email;
            localStorage.setItem('sann404_mail', currentEmail);
            emailDisplay.innerText = currentEmail;
            renderMessages([]);
            switchTab('view-home', document.querySelector('.nav-item:first-child'));
        } else {
            emailDisplay.innerText = "Gagal. Coba lagi.";
        }
    } catch (e) {
        emailDisplay.innerText = "Error Jaringan";
    }
}

async function fetchInbox() {
    if (!currentEmail) return;
    try {
        // DISINI PERUBAHANNYA: Mengarah ke /api/api
        const res = await fetch(`/api/api?action=inbox&email=${currentEmail}`);
        const data = await res.json();

        if (data.success && data.result.inbox) {
            const serverMessages = data.result.inbox;
            const existingMessages = await getAllMessagesFromDB();
            const deletedIDs = await getAllDeletedIDs();
            const deletedSet = new Set(deletedIDs.map(d => d.id));

            let hasNew = false;
            for (const msg of serverMessages) {
                // Buat ID unik berdasarkan pengirim dan subjek
                const msgId = btoa(msg.from + msg.subject).substring(0, 16);
                const exists = existingMessages.find(m => m.id === msgId);
                const isDeleted = deletedSet.has(msgId);

                if (!exists && !isDeleted) {
                    await saveMessageToDB({ 
                        ...msg, 
                        id: msgId, 
                        isRead: false,
                        created: msg.time || new Date().toLocaleTimeString() 
                    });
                    hasNew = true;
                }
            }
            if(hasNew) await loadCachedMessages();
        }
    } catch (e) {
        console.log("Fetch Inbox Fail");
    }
}

// --- FUNGSI HELPER TETAP SAMA ---
function saveMessageToDB(msg) {
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_MSG, 'readwrite');
        tx.objectStore(STORE_MSG).put(msg); 
        tx.oncomplete = () => resolve();
    });
}
function getAllMessagesFromDB() {
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_MSG, 'readonly');
        const request = tx.objectStore(STORE_MSG).getAll();
        request.onsuccess = () => resolve(request.result || []);
    });
}
function getAllDeletedIDs() {
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_DELETED, 'readonly');
        const request = tx.objectStore(STORE_DELETED).getAll();
        request.onsuccess = () => resolve(request.result || []);
    });
}
async function loadCachedMessages() {
    const messages = await getAllMessagesFromDB();
    renderMessages(messages);
}

function renderMessages(messages) {
    const unreadContainer = document.getElementById('unreadList');
    const readContainer = document.getElementById('readList');
    let unreadHTML = ''; let readHTML = ''; let unreadCount = 0;

    messages.forEach((msg) => {
        const initial = msg.from ? msg.from.charAt(0).toUpperCase() : '?';
        const html = `
            <div class="message-card ${msg.isRead ? 'read' : 'unread'}" onclick="openMessage('${msg.id}')">
                <div class="msg-avatar">${initial}</div>
                <div class="msg-content">
                    <div class="msg-header">
                        <span class="msg-from">${msg.from}</span>
                        <span class="msg-time">${msg.created}</span>
                    </div>
                    <div class="msg-subject">${msg.subject}</div>
                    <div class="msg-snippet">${msg.message.substring(0, 50)}...</div>
                </div>
            </div>
        `;
        if (msg.isRead) readHTML += html; else { unreadHTML += html; unreadCount++; }
    });

    unreadContainer.innerHTML = unreadHTML || emptyState('updates');
    readContainer.innerHTML = readHTML || emptyState('inbox');
    updateBadge(unreadCount);
}

async function openMessage(msgId) {
    const messages = await getAllMessagesFromDB();
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;
    currentOpenMsgData = msg;
    document.getElementById('modalSubject').innerText = msg.subject;
    document.getElementById('modalBody').innerText = msg.message;
    document.getElementById('modalMeta').innerHTML = `<div class="meta-info"><span class="meta-from">${msg.from}</span><br><span class="meta-time">${msg.created}</span></div>`;
    document.getElementById('msgModal').classList.add('show');
    if (!msg.isRead) { msg.isRead = true; await saveMessageToDB(msg); await loadCachedMessages(); }
}

function copyEmail() {
    const email = document.getElementById('emailAddress').innerText;
    navigator.clipboard.writeText(email);
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

function switchTab(viewId, element) {
    document.querySelectorAll('.tab-view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
}

function updateBadge(count) {
    const badge = document.getElementById('badge-count');
    const dot = document.getElementById('nav-dot');
    badge.innerText = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
    dot.style.display = count > 0 ? 'block' : 'none';
}

function emptyState(type) {
    return `<div class="empty-placeholder"><p>Kosong</p></div>`;
}

function startAutoRefresh() {
    let timeLeft = 10;
    setInterval(() => {
        timeLeft--;
        document.getElementById('timerText').innerText = `Auto-refresh: ${timeLeft}s`;
        if (timeLeft <= 0) { fetchInbox(); timeLeft = 10; }
    }, 1000);
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }
// Tambahkan fungsi share jika diperlukan sesuai HTML kamu
