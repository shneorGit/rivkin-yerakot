(() => {
    const UNIT_PIECE = "יח'";
    const UNIT_KG = 'ק״ג';

    // כתובת הסקריפט של גוגל (טעינת הקטלוג ושליחת הזמנות)
    const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbynKmEjuR0AyRVoXuRcEvN_4b32ggSnhlbZ9iaRtvpJcJUV8NeKizNODCyU5_9b3oHq8Q/exec';
    const LOAD_TIMEOUT_MS = 25000;
    const ORDER_TIMEOUT_MS = 45000;

    const $ = (id) => document.getElementById(id);

    // --- גישה בטוחה ל-localStorage (עלול להיות חסום או להכיל נתונים פגומים) ---
    function safeGetItem(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSetItem(key, value) {
        try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
    }
    function safeRemoveItem(key) {
        try { localStorage.removeItem(key); } catch (e) { /* התעלמות */ }
    }
    function safeParse(key, fallback) {
        try {
            const raw = safeGetItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    // מנקה סל/רשימה שנטענו מהאחסון: משאיר רק פריטים עם מבנה וכמות תקינים
    function sanitizeCart(raw) {
        const clean = {};
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
        for (const id of Object.keys(raw)) {
            const item = raw[id];
            if (!item || typeof item !== 'object') continue;
            const qty = Number(item.qty);
            if (!isFinite(qty) || qty <= 0 || qty > 999) continue;
            if (item.unit !== UNIT_PIECE && item.unit !== UNIT_KG) continue;
            clean[id] = { qty: item.qty, unit: item.unit };
            const note = cleanNote(item.note);
            if (note) clean[id].note = note;
        }
        return clean;
    }

    // הערה למוצר ("גדולים", "לא בשלים"...): שורה אחת, עד 80 תווים
    const MAX_ITEM_NOTE = 80;
    function cleanNote(value) {
        return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_NOTE) : '';
    }

    function isUnitValidForProduct(product, unit) {
        if (product.unitType === 'kg') return unit === UNIT_KG;
        if (product.unitType === 'unit') return unit === UNIT_PIECE;
        return unit === UNIT_PIECE || unit === UNIT_KG;
    }

    let products = [];
    let unavailableProducts = [];
    let unavailableNames = {};
    let categoryOrder = [];
    let cart = sanitizeCart(safeParse('rivkin_cart', {}));
    let currentCategory = 'הכל';
    let categoryBeforeSearch = null;
    let searchQuery = '';
    let searchTimer = null;
    let deliveryMethod = 'delivery';
    let lastCartCount = null;
    let lastOrderList = null; // ההזמנה האחרונה שנשלחה, לשמירה כרשימה קבועה ממסך ההצלחה

    const escapeHTML = (str) => {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    };

    // תמונות המוצרים יושבות בגוגל דרייב במשקל מלא (כ-1.5 עד 2 מ"ב כל אחת).
    // הוספת "=w<רוחב>" לכתובת גורמת לגוגל להחזיר גרסה מוקטנת (עשרות ק"ב), וזה מה שמאיץ את הטעינה.
    // כתובת שאינה של גוגל, או שכבר יש בה גודל, נשארת כמו שהיא.
    function sizedImage(url, width) {
        const u = String(url || '').trim();
        if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+$/.test(u)) return u + '=w' + width;
        return u;
    }

    // לשימוש בתוך תכונות HTML (גרשיים מוחלפים כדי שלא ישברו את התכונה)
    const escapeAttr = (str) => escapeHTML(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const saveCart = () => {
        safeSetItem('rivkin_cart', JSON.stringify(cart));
    };

    // ==========================================
    // וואטסאפ, הכרזות לקוראי מסך והודעות קצרות
    // ==========================================
    function whatsappLink(text) {
        const anchor = document.querySelector('.whatsapp-float');
        const href = anchor ? anchor.getAttribute('href') || '' : '';
        const base = href ? href.split('?')[0] : 'https://wa.me/972543243599';
        return base + '?text=' + encodeURIComponent(text);
    }

    let announceTimer = null;
    function announce(text) {
        const el = $('live-status');
        if (!el) return;
        clearTimeout(announceTimer);
        el.textContent = '';
        announceTimer = setTimeout(() => { el.textContent = text; }, 50);
    }

    // טקסט שמתחיל באימוג'י: האימוג'י מוסתר מקורא מסך (שלא יקריא "משאית", "שעון"...)
    const LEADING_ICON = /^([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{270E}]\u{FE0F}?)\s*/u;
    function setIconText(el, text) {
        if (!el) return;
        text = String(text || '');
        const m = text.match(LEADING_ICON);
        el.textContent = '';
        if (!m) { el.textContent = text; return; }
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = m[1] + ' ';
        el.append(icon, text.slice(m[0].length));
    }

    let toastTimer = null;
    function showToast(text, ms) {
        const el = $('toast');
        if (!el) return;
        clearTimeout(toastTimer);
        el.textContent = text;
        el.classList.add('show');
        toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3200);
    }

    // ==========================================
    // חלון הודעות בתוך האתר (במקום alert / confirm)
    // ==========================================
    const dialogQueue = [];
    let currentDialog = null;
    let dialogLastFocus = null;

    function openDialog(options) {
        return new Promise(resolve => {
            dialogQueue.push({ options, resolve });
            if (!currentDialog) showNextDialog();
        });
    }

    function getDialogButtons() {
        const actions = $('app-dialog-actions');
        return actions ? Array.from(actions.querySelectorAll('button')) : [];
    }

    // כל מה שאפשר להגיע אליו במקלדת בתוך החלון (כפתורים ושדות), לפי הסדר
    function getDialogFocusables() {
        const box = document.querySelector('#app-dialog .dialog-box');
        return box ? Array.from(box.querySelectorAll('button, input, textarea, select, a[href]')).filter(el => !el.disabled && el.offsetParent !== null) : [];
    }

    function showNextDialog() {
        const next = dialogQueue.shift();
        if (!next) return;
        const overlay = $('app-dialog');
        if (!overlay) {
            // אם מסיבה כלשהי אין חלון בדף, לא נתקעים
            next.resolve(next.options.cancelValue);
            if (dialogQueue.length) showNextDialog();
            return;
        }
        currentDialog = next;
        if (!dialogLastFocus) dialogLastFocus = document.activeElement;

        const titleEl = $('app-dialog-title');
        const messageEl = $('app-dialog-message');
        const actionsEl = $('app-dialog-actions');
        const bodyEl = $('app-dialog-body');
        titleEl.textContent = next.options.title || '';
        messageEl.textContent = next.options.message || '';
        actionsEl.innerHTML = '';
        if (bodyEl) {
            bodyEl.innerHTML = '';
            // תוכן נוסף בחלון (למשל עורך ההערה למוצר)
            if (typeof next.options.content === 'function') next.options.content(bodyEl);
            bodyEl.classList.toggle('hidden', !bodyEl.childNodes.length);
        }

        next.options.buttons.forEach(btn => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'dialog-btn dialog-btn-' + (btn.kind || 'secondary');
            el.textContent = btn.label;
            el.addEventListener('click', () => closeDialog(btn.value));
            actionsEl.appendChild(el);
        });

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        const buttons = getDialogButtons();
        let focusIndex = next.options.buttons.findIndex(b => b.value === next.options.focusValue);
        if (focusIndex < 0) focusIndex = 0;
        if (buttons[focusIndex]) buttons[focusIndex].focus();
    }

    function closeDialog(value) {
        if (!currentDialog) return;
        const done = currentDialog;
        currentDialog = null;

        const overlay = $('app-dialog');
        if (overlay) overlay.classList.remove('active');

        if (dialogQueue.length === 0) {
            if (!getOpenImageModal()) document.body.style.overflow = '';
            const toFocus = dialogLastFocus;
            dialogLastFocus = null;
            if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
                try { toFocus.focus(); } catch (e) { /* התעלמות */ }
            }
        }

        done.resolve(value);
        if (dialogQueue.length) showNextDialog();
    }

    function showMessage(message, opts) {
        const o = opts || {};
        return openDialog({
            title: o.title || '',
            message,
            buttons: [{ label: o.buttonLabel || 'הבנתי', value: true, kind: 'primary' }],
            cancelValue: true,
            focusValue: true
        });
    }

    function showConfirm(message, opts) {
        const o = opts || {};
        return openDialog({
            title: o.title || '',
            message,
            buttons: [
                { label: o.confirmLabel || 'אישור', value: true, kind: o.danger ? 'danger' : 'primary' },
                { label: o.cancelLabel || 'ביטול', value: false, kind: 'secondary' }
            ],
            cancelValue: false,
            focusValue: o.danger ? false : true
        });
    }

    // ==========================================
    // שגיאות בשדות הטופס
    // ==========================================
    function setFieldError(inputId, message) {
        const input = $(inputId);
        const err = $('err-' + inputId);
        if (err) err.textContent = message || '';
        if (input) {
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
            input.classList.toggle('input-error', !!message);
        }
    }

    function clearFieldError(inputId) {
        setFieldError(inputId, '');
    }

    function focusField(inputId) {
        const el = $(inputId);
        if (!el) return;
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }

    function normalizePhone(raw) {
        let p = String(raw || '').replace(/[\s\-().‎‏‪-‮]/g, '');
        if (p.startsWith('+972')) p = '0' + p.slice(4);
        else if (p.startsWith('00972')) p = '0' + p.slice(5);
        else if (p.startsWith('972')) p = '0' + p.slice(3);
        return p;
    }

    // ==========================================
    // טעינת הקטלוג
    // ==========================================
    async function fetchWithTimeout(url, options, ms) {
        if (typeof AbortController === 'undefined') return fetch(url, options);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
        } finally {
            clearTimeout(timer);
        }
    }

    // פונקציות נרמול לחיפוש: בלי ניקוד וגרשיים, אותיות סופיות כרגילות
    function baseNormalize(str) {
        return String(str || '').toLowerCase()
            .replace(/[֑-ׇ]/g, '')
            .replace(/[׳״'"`´‘’“”]/g, '')
            .replace(/[\-–—_.,:;!?()\[\]{}\/\\|+*&]/g, ' ')
            .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
            .replace(/\s+/g, ' ').trim();
    }
    // גרסה "סלחנית": בלי ו' וי', כדי ש"עגבניה" ו"עגבנייה" יתאימו
    function looseNormalize(str) {
        return baseNormalize(str).replace(/[וי]/g, '').replace(/\s+/g, ' ').trim();
    }

    function buildSearchKeys(p) {
        p.sBase = baseNormalize(p.rawName);
        p.sLoose = looseNormalize(p.rawName);
        p.cBase = baseNormalize(p.categoryRaw);
        p.cLoose = looseNormalize(p.categoryRaw);
    }

    function mapRow(item) {
        let stockVal = String(item['במלאי'] || '').trim().toLowerCase();
        let isAvailable = !['לא', 'false', '0', 'no'].includes(stockVal);

        let rawUnit = String(item['סוג יחידה'] || '').trim();
        let mappedUnit = 'both';
        if (rawUnit === 'יחידות בלבד') mappedUnit = 'unit';
        else if (rawUnit === 'ק"ג בלבד') mappedUnit = 'kg';
        // המחיר בגיליון: לק"ג במוצר "גם וגם" או "ק"ג בלבד", ליחידה במוצר "יחידות בלבד"
        const pricePerKg = mappedUnit !== 'unit';

        // הגבלת כמות (עמודה "הגבלה", 1 עד 5): רק במוצר שנמכר ביחידות.
        // מוצר "גם וגם" שמוגבל נמכר רק ביחידות, עד שמורידים את ההגבלה
        let limit = Number(String(item['הגבלה'] ?? '').trim());
        if (!Number.isInteger(limit) || limit < 1 || limit > 99 || mappedUnit === 'kg') limit = 0;
        if (limit && mappedUnit === 'both') mappedUnit = 'unit';

        // תוויות מהעמודה "תוויות" (השרת מוסיף להן צבע). "מבצע" ו"חדש" עובדות כמו העמודות הישנות
        const labels = Array.isArray(item['__labels'])
            ? item['__labels'].filter(l => l && typeof l.t === 'string' && l.t.trim()).slice(0, 4).map(l => ({
                t: l.t.trim(),
                bg: /^#[0-9a-f]{6}$/i.test(l.bg) ? l.bg : '#334155',
                fg: /^#[0-9a-f]{6}$/i.test(l.fg) ? l.fg : '#ffffff'
            }))
            : [];
        const hasLabel = (t) => labels.some(l => l.t === t);

        let numericPrice = parseFloat(String(item['מחיר'] || '').replace(/[₪,]/g, '')) || 0;
        const categoryRaw = item['קטגוריה'] ? String(item['קטגוריה']).trim() : '';

        const p = {
            id: Number(item['מזהה']),
            name: escapeHTML(item['שם']),
            rawName: String(item['שם'] || '').trim(),
            isNew: String(item['חדש'] || '').trim() === 'כן' || hasLabel('חדש'),
            isSale: String(item['מבצע'] || '').trim() === 'כן' || hasLabel('מבצע'),
            labels: labels,
            limit: limit,
            pricePerKg: pricePerKg,
            hasId: String(item['מזהה'] === undefined || item['מזהה'] === null ? '' : item['מזהה']).trim() !== '',
            price: numericPrice,
            category: escapeHTML(categoryRaw || 'כללי'),
            categoryRaw: categoryRaw || 'כללי',
            unitType: mappedUnit,
            image: item['תמונה'],
            inStock: isAvailable
        };
        buildSearchKeys(p);
        return p;
    }

    // פריטים בסל עם כמות תקינה שקיימים כרגע בקטלוג (במלאי)
    function getValidItemIds() {
        return Object.keys(cart).filter(id => {
            const item = cart[id];
            return item && item.qty !== '' && Number(item.qty) > 0 && products.some(p => p.id == id);
        });
    }

    // מסיר מהסל מוצרים שכבר לא קיימים בקטלוג או שאזלו (למשל סל שנשמר מאתמול)
    function reconcileCartWithCatalog() {
        if (products.length === 0) return; // הגנה: גיליון ריק זמנית לא ימחק את הסל
        let changed = false;
        Object.keys(cart).forEach(id => {
            const product = products.find(p => p.id == id);
            if (!product || !isUnitValidForProduct(product, cart[id].unit)) {
                delete cart[id];
                changed = true;
            }
        });
        if (changed) saveCart();
    }

    function renderLoadError() {
        const grid = $('products-grid');
        if (!grid) return;
        const link = whatsappLink('היי, האתר לא טוען לי את המוצרים');
        grid.innerHTML = `
            <div class="load-error" role="alert">
                <div class="load-error-title">לא הצלחנו לטעון את המוצרים כרגע</div>
                <p>בדוק את החיבור לאינטרנט ונסה שוב. אם זה חוזר, אפשר לפנות אלינו בוואטסאפ.</p>
                <div class="load-error-actions">
                    <button type="button" class="load-error-btn" onclick="retryLoadProducts()">נסה שוב</button>
                    <a class="load-error-link" href="${escapeAttr(link)}" target="_blank" rel="noopener">פנה אלינו בוואטסאפ</a>
                </div>
            </div>`;
    }

    function retryLoadProducts() {
        const grid = $('products-grid');
        if (grid) grid.innerHTML = '<p class="grid-note">טוען מוצרים מהחנות...</p>';
        loadProducts();
    }

    // ------------------------------------------
    // טעינה מהירה ויציבה של הקטלוג:
    // 1. קטלוג שמור מהביקור הקודם מוצג מיד, ומתעדכן ברקע.
    // 2. אם גוגל איטי, נשלחת בקשה נוספת בלי לבטל את הקודמת. הראשונה שעונה מנצחת.
    // ------------------------------------------
    const CATALOG_CACHE_KEY = 'rivkin_catalog_v1';
    const CATALOG_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // קטלוג ישן משבוע לא מוצג
    const LOAD_ATTEMPT_DELAYS_MS = [0, 4000, 10000];           // מתי יוצאת כל בקשה
    const SLOW_NOTICE_MS = 4000;                               // מתי מופיעה ההודעה "לוקח יותר זמן"
    let loadInFlight = false;

    function readCachedCatalog() {
        const cached = safeParse(CATALOG_CACHE_KEY, null);
        if (!cached || !Array.isArray(cached.data) || typeof cached.t !== 'number') return null;
        if (Date.now() - cached.t > CATALOG_CACHE_MAX_AGE_MS) return null;
        return cached.data;
    }

    function writeCachedCatalog(data) {
        safeSetItem(CATALOG_CACHE_KEY, JSON.stringify({ t: Date.now(), data: data }));
    }

    // בקשה אחת לקטלוג. מחזירה את המערך, או נכשלת
    async function fetchCatalogOnce(signal) {
        const response = await fetch(SCRIPT_URL, { signal: signal, cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Unexpected catalog response');
        return data;
    }

    // כמה בקשות במדורג. בקשה שנכשלה מהר מקדימה את הבאה בתור
    function fetchCatalogWithRetries(onSlow) {
        return new Promise((resolve, reject) => {
            const controllers = [];
            const timers = [];
            let launched = 0;
            let failed = 0;
            let done = false;

            const finish = (ok, value) => {
                if (done) return;
                done = true;
                timers.forEach(clearTimeout);
                controllers.forEach(c => { try { c.abort(); } catch (e) { /* התעלמות */ } });
                ok ? resolve(value) : reject(value);
            };

            const launch = () => {
                if (done || launched >= LOAD_ATTEMPT_DELAYS_MS.length) return;
                launched++;
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                if (controller) controllers.push(controller);
                fetchCatalogOnce(controller ? controller.signal : undefined)
                    .then(data => finish(true, data))
                    .catch(err => {
                        if (done) return;
                        failed++;
                        console.warn('ניסיון טעינה נכשל:', err && err.message);
                        if (failed >= LOAD_ATTEMPT_DELAYS_MS.length) finish(false, err);
                        else if (failed >= launched) launch(); // אין בקשה פעילה: לא מחכים לתור
                    });
            };

            LOAD_ATTEMPT_DELAYS_MS.forEach(delay => {
                timers.push(setTimeout(launch, delay));
            });
            timers.push(setTimeout(() => { if (!done && onSlow) onSlow(); }, SLOW_NOTICE_MS));
            timers.push(setTimeout(() => finish(false, new Error('Catalog load timed out')), LOAD_TIMEOUT_MS));
        });
    }

    // פס קטן מעל המוצרים: "מעדכן מחירים ומלאי"
    function setSyncNote(text) {
        let note = $('catalog-sync-note');
        const grid = $('products-grid');
        if (!text) {
            if (note) note.remove();
            return;
        }
        if (!note && grid && grid.parentNode) {
            note = document.createElement('div');
            note.id = 'catalog-sync-note';
            note.className = 'catalog-sync-note';
            note.setAttribute('role', 'status');
            grid.parentNode.insertBefore(note, grid);
        }
        if (note) note.textContent = text;
    }

    function setGridLoadingText(text) {
        const note = document.querySelector('#products-grid .grid-note');
        if (note) note.textContent = text;
    }

    // מוצרים שבסל ולא יהיו זמינים לפי הקטלוג החדש (אזלו, נמחקו או שהיחידה כבר לא קיימת)
    function findCartItemsToRemove(newProducts) {
        return Object.keys(cart).filter(id => {
            const product = newProducts.find(p => p.id == id);
            return !product || !isUnitValidForProduct(product, cart[id].unit);
        });
    }

    async function loadProducts() {
        if (loadInFlight) return;
        loadInFlight = true;

        // שלב 1: קטלוג שמור מוצג מיד (בלי להוריד מהסל כלום, כי הוא עלול להיות ישן)
        let shownFromCache = false;
        if (products.length === 0) {
            const cachedData = readCachedCatalog();
            if (cachedData) {
                try {
                    applyCatalog(cachedData, { fromCache: true });
                    shownFromCache = products.length > 0;
                } catch (e) {
                    console.warn('קטלוג שמור פגום, מתעלמים ממנו', e);
                    safeRemoveItem(CATALOG_CACHE_KEY);
                }
            }
        }
        if (shownFromCache) setSyncNote('⟳ מעדכן מחירים ומלאי...');

        // שלב 2: קטלוג עדכני מהגיליון
        try {
            const data = await fetchCatalogWithRetries(() => {
                if (shownFromCache) return;
                setGridLoadingText('הטעינה לוקחת קצת יותר זמן מהרגיל, עוד רגע...');
            });

            const nameById = {};
            products.forEach(p => { nameById[p.id] = p.rawName; });

            applyCatalog(data, { fromCache: false, previousNames: nameById });
            writeCachedCatalog(data);
            setSyncNote('');
        } catch (error) {
            console.error('Error loading products:', error);
            if (shownFromCache) {
                // יש מוצרים על המסך: לא מסתירים אותם, רק מציינים שלא התעדכנו
                setSyncNote('לא הצלחנו לעדכן את המחירים והמלאי כרגע. ההזמנה תיבדק מול המלאי העדכני בשליחה.');
            } else {
                renderLoadError();
            }
        } finally {
            loadInFlight = false;
        }
    }

    // מציג קטלוג (שמור או עדכני) על המסך
    function applyCatalog(data, opts) {
        const fromCache = !!(opts && opts.fromCache);
        const previousNames = (opts && opts.previousNames) || {};
        {
            // השורה האחרונה מהשרת היא נתוני לוח הזמנים (לא מוצר)
            const metaRow = data.find(r => r && typeof r === 'object' && r['__meta']);
            if (metaRow) applyScheduleMeta(metaRow['__meta'], fromCache);
            data = data.filter(r => !(r && typeof r === 'object' && r['__meta']));
            let all = data.map(mapRow);

            // מתעלם משורות לא שלמות בגיליון (בלי מזהה, שם או מחיר), כדי שמוצר חצי-מלא לא יעלה לאתר
            const totalRows = all.length;
            all = all.filter(p => p.hasId && Number.isFinite(p.id) && p.rawName !== '' && p.price > 0);
            if (all.length < totalRows) {
                console.warn('דולגו ' + (totalRows - all.length) + ' שורות לא שלמות בגיליון (חסר מזהה, שם או מחיר)');
            }

            unavailableNames = {};
            unavailableProducts = [];
            all.forEach(p => {
                if (!p.inStock) {
                    unavailableNames[p.id] = p.rawName;
                    unavailableProducts.push(p);
                }
            });
            products = all.filter(p => p.inStock);

            // סדר לשוניות הקטגוריות נשאר לפי סדר הגיליון, גם כשמוצר חדש עולה לראש הרשימה
            categoryOrder = [...new Set(products.map(p => p.categoryRaw))];
            // מוצרים שמסומנים "כן" בעמודה "חדש" עולים למעלה; כל השאר נשארים בסדר הגיליון
            products = [...products.filter(p => p.isNew), ...products.filter(p => !p.isNew)];

            // רק קטלוג עדכני מוריד מוצרים מהסל, ואז הלקוח מקבל הודעה ברורה
            let removedNames = [];
            let limitMsg = '';
            if (!fromCache && products.length > 0) {
                limitMsg = enforceCartLimits(cart);
                if (limitMsg) saveCart();
                removedNames = findCartItemsToRemove(products)
                    .map(id => unavailableNames[id] || previousNames[id])
                    .filter(Boolean);
                reconcileCartWithCatalog();
            }

            // קטגוריה שנבחרה ונעלמה בעדכון: חוזרים ל"הכל"
            if (currentCategory !== 'הכל' && !categoryOrder.includes(currentCategory)) {
                currentCategory = 'הכל';
            }

            // שומרים על הפוקוס ועל מיקום הגלילה כשהקטלוג מתעדכן מתחת לידיים של הלקוח
            const active = document.activeElement;
            const activeId = active && active.id ? active.id : null;
            const scrollY = window.scrollY;

            renderCategories();
            renderProducts();
            renderCart();

            if (activeId && activeId !== 'search-input') {
                const again = $(activeId);
                if (again && again !== document.activeElement) {
                    try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); }
                }
            }
            if (!fromCache && Math.abs(window.scrollY - scrollY) > 2) window.scrollTo(0, scrollY);

            if (removedNames.length > 0) {
                const msg = removedNames.length === 1
                    ? removedNames[0] + ' אזל מהמלאי והוסר מהסל'
                    : removedNames.join(', ') + ' אזלו מהמלאי והוסרו מהסל';
                showToast(msg, 7000);
                announce(msg);
            }
            if (limitMsg) showMessage(limitMsg, { title: 'עדכון בסל' });
        }
    }

    function renderCategories() {
        const categoriesBar = $('categories-bar');
        const categories = ['הכל', ...categoryOrder];

        categoriesBar.innerHTML = categories.map(cat => {
            const active = currentCategory === cat;
            return `<button type="button" class="category-tab ${active ? 'active' : ''}" data-category="${escapeAttr(cat)}" aria-pressed="${active}" onclick="filterCategory(this.dataset.category, this)">${escapeHTML(cat)}</button>`;
        }).join('');
    }

    // ==========================================
    // חיפוש וסינון
    // ==========================================
    function resetSearchState() {
        clearTimeout(searchTimer);
        searchQuery = '';
        categoryBeforeSearch = null;
        const input = $('search-input');
        if (input) input.value = '';
        const clearBtn = $('clear-search-btn');
        if (clearBtn) clearBtn.style.display = 'none';
        const status = $('search-status');
        if (status) status.textContent = '';
    }

    function filterCategory(category) {
        // בחירת קטגוריה היא מעבר לגלישה רגילה, ולכן החיפוש מתנקה
        if (searchQuery) resetSearchState();
        currentCategory = category;
        document.querySelectorAll('.category-tab').forEach(btn => {
            const on = btn.dataset.category === category;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderProducts();
        scrollToCatalogTopIfNeeded();
    }

    function handleSearch(query) {
        const trimmed = String(query || '').trim();
        const wasSearching = searchQuery !== '';
        searchQuery = trimmed;

        const clearBtn = $('clear-search-btn');
        if (clearBtn) clearBtn.style.display = trimmed.length > 0 ? 'flex' : 'none';

        if (trimmed && !wasSearching) {
            // חיפוש עובר על כל הקטגוריות
            categoryBeforeSearch = currentCategory;
            if (currentCategory !== 'הכל') {
                currentCategory = 'הכל';
                renderCategories();
            }
        } else if (!trimmed && wasSearching) {
            if (categoryBeforeSearch && categoryBeforeSearch !== 'הכל') {
                currentCategory = categoryBeforeSearch;
                renderCategories();
            }
            categoryBeforeSearch = null;
        }

        clearTimeout(searchTimer);
        if (!trimmed) {
            renderProducts();
        } else {
            searchTimer = setTimeout(renderProducts, 120);
        }
    }

    function clearSearch() {
        const searchInput = $('search-input');
        if (searchInput) {
            searchInput.value = '';
            handleSearch('');
            searchInput.focus();
        }
    }

    function prepareQuery(q) {
        return baseNormalize(q).split(' ').filter(Boolean).map(t => ({ base: t, loose: t.replace(/[וי]/g, '') }));
    }

    function tokenInText(token, base, loose) {
        return token.loose ? loose.includes(token.loose) : base.includes(token.base);
    }

    // 0 = התאמה מההתחלה, 1 = תחילת מילה, 2 = בתוך השם, 3 = התאמה דרך הקטגוריה, null = אין התאמה
    function scoreProduct(p, tokens, nameOnly) {
        if (tokens.length === 0) return 0;
        if (tokens.every(t => tokenInText(t, p.sBase, p.sLoose))) {
            const first = tokens[0];
            const key = first.loose || first.base;
            const text = first.loose ? p.sLoose : p.sBase;
            if (text.startsWith(key)) return 0;
            if (text.split(' ').some(w => w.startsWith(key))) return 1;
            return 2;
        }
        if (nameOnly) return null;
        if (tokens.every(t => tokenInText(t, p.sBase + ' ' + p.cBase, p.sLoose + ' ' + p.cLoose))) return 3;
        return null;
    }

    function rankProducts(list, tokens, nameOnly) {
        return list
            .map((p, i) => ({ p, i, s: scoreProduct(p, tokens, nameOnly) }))
            .filter(x => x.s !== null)
            .sort((a, b) => a.s - b.s || a.i - b.i)
            .map(x => x.p);
    }

    // תוויות על תמונת המוצר: מהעמודה "תוויות" (עם הצבע מהלשונית "תוויות"),
    // ו"מבצע"/"חדש" מהעמודות הישנות כשהן לא נבחרו גם כתווית
    function productBadgesHTML(p) {
        const parts = [];
        const has = (t) => p.labels.some(l => l.t === t);
        if (p.isSale && !has('מבצע')) parts.push('<span class="product-badge sale-badge">מבצע</span>');
        if (p.isNew && !has('חדש')) parts.push('<span class="product-badge new-badge">חדש</span>');
        p.labels.forEach(l => {
            parts.push(`<span class="product-badge" style="background:${l.bg};color:${l.fg};">${escapeHTML(l.t)}</span>`);
        });
        return parts.length ? '<div class="product-badges">' + parts.join('') + '</div>' : '';
    }

    // השורה "עד X יח' להזמנה" מתחת למחיר, עם קישור לוואטסאפ לכמות גדולה יותר
    function limitNoteHTML(p) {
        if (!p.limit) return '';
        const link = whatsappLink('היי, אשמח להזמין יותר מ-' + p.limit + ' יח\' של ' + p.rawName);
        return `<div class="limit-note">עד ${p.limit} יח' להזמנה · <a href="${escapeAttr(link)}" target="_blank" rel="noopener">לכמות גדולה יותר</a></div>`;
    }

    function limitMessage(p) {
        return 'אפשר להזמין עד ' + p.limit + ' יח\' ' + p.rawName + '. לכמות גדולה יותר אפשר לפנות אלינו בוואטסאפ.';
    }

    // כפתור ההערה למוצר. מוצג רק כשהמוצר בסל (לפי המחלקה in-cart של הכרטיס)
    function itemNoteButtonHTML(p, note, inCart) {
        const nameAttr = escapeAttr(p.rawName);
        const icon = '<span aria-hidden="true">✎ </span>';
        const text = icon + (note ? escapeHTML(note) : 'הוספת הערה (גודל, בשלות)');
        return `<button type="button" class="item-note-btn ${note ? 'has-note' : ''} ${inCart ? '' : 'cart-only'}" onclick="editItemNote(${p.id})" aria-label="${note ? 'עריכת הערה: ' + nameAttr + ': ' + escapeAttr(note) : 'הוספת הערה: ' + nameAttr}">${text}</button>`;
    }

    function productCardHTML(p) {
        const isBoth = p.unitType === 'both';
        const isKgOnly = p.unitType === 'kg';
        const nameAttr = escapeAttr(p.rawName);

        const currentItem = cart[p.id] || { qty: '', unit: isKgOnly ? 'ק״ג' : 'יח\'' };
        const selectedUnit = currentItem.unit;
        const qtyVal = currentItem.qty;

        const isDecimalAllowed = isKgOnly || (isBoth && selectedUnit === 'ק״ג');
        const inputStep = isDecimalAllowed ? "0.1" : "1";
        const inputMode = isDecimalAllowed ? "decimal" : "numeric";

        let unitSelectorHTML = '';
        let quickButtonsHTML = '';

        if (isKgOnly) {
            unitSelectorHTML = `<span class="unit-badge">ק״ג</span>`;
            quickButtonsHTML = generateQuickButtons(p);
        } else if (isBoth) {
            // שני כפתורים צמודים במקום רשימה נפתחת: לחיצה אחת במקום שתיים
            const isPiece = selectedUnit !== UNIT_KG;
            unitSelectorHTML = `
                <div class="unit-toggle" role="group" aria-label="יחידת מידה: ${nameAttr}">
                    <button type="button" class="unit-toggle-btn ${isPiece ? 'active' : ''}" aria-pressed="${isPiece}" onclick="updateCartUnit(${p.id}, 'piece')">יח'</button>
                    <button type="button" class="unit-toggle-btn ${!isPiece ? 'active' : ''}" aria-pressed="${!isPiece}" onclick="updateCartUnit(${p.id}, 'kg')">ק״ג</button>
                </div>
            `;
            if (selectedUnit === 'ק״ג') {
                quickButtonsHTML = generateQuickButtons(p);
            }
        } else {
            unitSelectorHTML = `<span class="unit-badge">יח'</span>`;
        }

        const unitLabel = p.pricePerKg ? 'לק״ג' : 'ליחידה';
        const isInCart = currentItem.qty !== '' && Number(currentItem.qty) > 0;
        const atLimit = !!p.limit && Number(currentItem.qty) >= p.limit;

        return `
            <div id="card-${p.id}" class="product-card ${isInCart ? 'in-cart' : ''}">
                <div class="product-img-container">
                    <img src="${escapeAttr(sizedImage(p.image, 480))}" alt="${nameAttr}" class="product-img" loading="lazy" decoding="async">
                    ${productBadgesHTML(p)}
                </div>
                <div class="product-info">
                    <div>
                        <div class="product-name">${p.name}</div>
                        <div class="product-price">₪${p.price.toFixed(2)} ${unitLabel}</div>
                        ${limitNoteHTML(p)}
                    </div>
                    <div class="product-actions-wrapper">
                        ${quickButtonsHTML}
                        <div class="card-action-row ${isBoth ? 'has-toggle' : ''}">
                            <div class="quantity-control">
                                <button type="button" class="qty-btn ${atLimit ? 'at-limit' : ''}" id="plus-${p.id}" aria-label="הוסף כמות: ${nameAttr}" ${atLimit ? 'aria-disabled="true"' : ''} onclick="changeQty(${p.id}, 1)">+</button>
                                <input type="number" step="${inputStep}" min="0" ${p.limit ? 'max="' + p.limit + '"' : ''} inputmode="${inputMode}" id="qty-${p.id}" placeholder="0"
                                    aria-label="כמות: ${nameAttr}"
                                    value="${escapeAttr(qtyVal)}" oninput="updateCartItem(${p.id}, this.value)"
                                    class="product-input">
                                <button type="button" class="qty-btn" aria-label="הפחת כמות: ${nameAttr}" onclick="changeQty(${p.id}, -1)">−</button>
                            </div>
                            ${unitSelectorHTML}
                        </div>
                        ${itemNoteButtonHTML(p, currentItem.note || '', isInCart)}
                    </div>
                </div>
            </div>
        `;
    }

    function unavailableCardHTML(p) {
        const nameAttr = escapeAttr(p.rawName);
        return `
            <div class="product-card unavailable-card">
                <div class="product-img-container">
                    <img src="${escapeAttr(sizedImage(p.image, 480))}" alt="${nameAttr}" class="product-img" loading="lazy" decoding="async">
                </div>
                <div class="product-info">
                    <div>
                        <div class="product-name">${p.name}</div>
                        <div class="unavailable-label">אזל כרגע</div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderProducts() {
        const grid = $('products-grid');
        const status = $('search-status');
        const hasQuery = searchQuery !== '';
        const tokens = hasQuery ? prepareQuery(searchQuery) : [];

        let list;
        let unavailableMatches = [];
        if (hasQuery && tokens.length > 0) {
            list = rankProducts(products, tokens, false);
            unavailableMatches = rankProducts(unavailableProducts, tokens, true);
        } else if (hasQuery) {
            list = products.slice();
        } else {
            list = products.filter(p => currentCategory === 'הכל' || p.categoryRaw === currentCategory);
        }

        if (status) {
            status.textContent = hasQuery
                ? (list.length === 0 ? 'לא נמצאו מוצרים' : 'נמצאו ' + list.length + ' מוצרים')
                : '';
        }

        if (list.length === 0 && unavailableMatches.length === 0) {
            if (hasQuery) {
                const shown = searchQuery.length > 40 ? searchQuery.slice(0, 40) + '…' : searchQuery;
                const link = whatsappLink('היי, אשמח לדעת אם יש לכם: ' + searchQuery);
                grid.innerHTML = `
                    <div class="no-results">
                        <div class="no-results-title">לא נמצאו מוצרים עבור "${escapeHTML(shown)}"</div>
                        <p>לא מצאת מה שחיפשת? ייתכן שיש לנו, אפשר לשאול אותנו.</p>
                        <a class="no-results-link" href="${escapeAttr(link)}" target="_blank" rel="noopener">שאל אותנו בוואטסאפ</a>
                    </div>`;
            } else {
                const link = whatsappLink('היי, אשמח לדעת מה יש היום בחנות');
                grid.innerHTML = `
                    <div class="no-results">
                        <div class="no-results-title">אין כרגע מוצרים להצגה</div>
                        <p>אפשר לנסות שוב מאוחר יותר, או לפנות אלינו.</p>
                        <a class="no-results-link" href="${escapeAttr(link)}" target="_blank" rel="noopener">פנה אלינו בוואטסאפ</a>
                    </div>`;
            }
            return;
        }

        let html = list.map(productCardHTML).join('');
        if (unavailableMatches.length > 0) {
            html += `<div class="unavailable-heading">לא זמין כרגע:</div>` + unavailableMatches.map(unavailableCardHTML).join('');
        }
        grid.innerHTML = html;
    }

    function generateQuickButtons(p) {
        const nameAttr = escapeAttr(p.rawName);
        let buttons = '';
        if (p.name.includes('דלעת')) {
            buttons += `<button type="button" class="quick-qty-btn" aria-label="300 גרם: ${nameAttr}" onclick="setQuickQty(${p.id}, 0.3, 'ק״ג')">300 גרם</button>`;
        }
        buttons += `
            <button type="button" class="quick-qty-btn" aria-label="חצי קילו: ${nameAttr}" onclick="setQuickQty(${p.id}, 0.5, 'ק״ג')">חצי קילו</button>
            <button type="button" class="quick-qty-btn" aria-label="קילו: ${nameAttr}" onclick="setQuickQty(${p.id}, 1, 'ק״ג')">קילו</button>
        `;
        return `<div class="quick-qty-row">${buttons}</div>`;
    }

    function setQuickQty(productId, qty, unit) {
        const product = products.find(p => p.id == productId);
        if (!product || !product.inStock) return;

        cart[productId] = withNote({ qty: qty, unit: unit }, productId);
        saveCart();
        renderProducts();
        renderCart();
    }

    // מעבירה את ההערה הקיימת של המוצר לרשומה החדשה בסל
    function withNote(entry, productId) {
        const note = cart[productId] && cart[productId].note;
        if (note) entry.note = note;
        return entry;
    }

    function changeQty(productId, delta) {
        const product = products.find(p => p.id == productId);
        if (!product || !product.inStock) return;

        let unit = 'יח\'';
        if (product.unitType === 'kg') unit = 'ק״ג';
        else if (product.unitType === 'both') unit = cart[productId]?.unit || 'יח\'';

        const isDecimalAllowed = unit === 'ק״ג';
        const step = isDecimalAllowed ? 0.5 : 1;

        let currentQty = cart[productId] ? parseFloat(cart[productId].qty) || 0 : 0;
        let newQty = Math.max(0, currentQty + (delta * step));
        if (product.limit && newQty > product.limit) {
            newQty = product.limit;
            showToast(limitMessage(product), 5000);
            announce(limitMessage(product));
            if (currentQty >= product.limit) return;
        }

        if (isDecimalAllowed) newQty = Math.round(newQty * 10) / 10;

        updateCartItem(productId, newQty === 0 ? '' : newQty.toString());
    }

    // פלוס ומינוס מתוך הסל: אותה לוגיקה כמו בכרטיס המוצר, והפוקוס נשאר על הכפתור
    function changeCartQty(productId, delta) {
        changeQty(productId, delta);
        const product = products.find(p => p.id == productId);
        const item = cart[productId];
        if (!product) return;
        if (item) {
            announce(product.rawName + ': ' + item.qty + ' ' + item.unit);
            const btn = document.querySelector(`[data-cart-qty="${productId}:${delta}"]`);
            if (btn) {
                try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
            }
        } else {
            announce(product.rawName + ' הוסר מהסל');
        }
    }

    function updateCartItem(productId, value) {
        const product = products.find(p => p.id == productId);
        if (!product || !product.inStock) return;

        let unit = 'יח\'';
        if (product.unitType === 'kg') unit = 'ק״ג';
        else if (product.unitType === 'both') unit = cart[productId]?.unit || 'יח\'';

        let finalVal = String(value);
        if (unit !== 'ק״ג' && finalVal.includes('.')) {
            finalVal = Math.floor(Number(finalVal)).toString();
        }
        if (product.limit && Number(finalVal) > product.limit) {
            finalVal = String(product.limit);
            showToast(limitMessage(product), 5000);
            announce(limitMessage(product));
        }

        if (finalVal.trim() === '' || Number(finalVal) <= 0) {
            delete cart[productId];
        } else {
            cart[productId] = withNote({ qty: finalVal, unit: unit }, productId);
        }

        saveCart();

        const inputField = $(`qty-${productId}`);
        if (inputField && inputField.value !== String(finalVal)) {
            inputField.value = finalVal;
        }

        const cardElement = $(`card-${productId}`);
        if (cardElement) {
            if (String(finalVal).trim() === '' || Number(finalVal) <= 0) {
                cardElement.classList.remove('in-cart');
            } else {
                cardElement.classList.add('in-cart');
            }
        }
        const plusBtn = $(`plus-${productId}`);
        if (plusBtn && product.limit) {
            const atLimit = Number(finalVal) >= product.limit;
            plusBtn.classList.toggle('at-limit', atLimit);
            if (atLimit) plusBtn.setAttribute('aria-disabled', 'true'); else plusBtn.removeAttribute('aria-disabled');
        }

        renderCart();
    }

    function updateCartUnit(productId, newUnit) {
        if (newUnit === 'piece') newUnit = UNIT_PIECE;
        else if (newUnit === 'kg') newUnit = UNIT_KG;
        if (newUnit !== UNIT_PIECE && newUnit !== UNIT_KG) return;

        // לחיצה על היחידה שכבר נבחרה לא משנה כלום (ולא מאפסת את הכמות)
        const currentUnit = cart[productId] ? cart[productId].unit : UNIT_PIECE;
        if (currentUnit === newUnit) return;

        // אי אפשר להמיר בין יחידות לק"ג, ולכן החלפת יחידה מאפסת את הכמות
        cart[productId] = withNote({ qty: '', unit: newUnit }, productId);
        saveCart();
        renderProducts();
        renderCart();
    }

    // ==========================================
    // הערה למוצר (גודל, בשלות...): נפתחת מכרטיס המוצר או מהסל
    // ==========================================
    const NOTE_CHIPS = ['גדולים', 'קטנים', 'רכים', 'קשים', 'בשלים', 'לא בשלים'];
    // זוגות הפכים: בחירה באחד מבטלת את השני (אפשר "גדולים" + "לא בשלים", אבל לא "רכים" + "קשים")
    const NOTE_OPPOSITES = { 'גדולים': 'קטנים', 'קטנים': 'גדולים', 'רכים': 'קשים', 'קשים': 'רכים', 'בשלים': 'לא בשלים', 'לא בשלים': 'בשלים' };
    const MAX_NOTE_FREE_TEXT = 40;

    async function editItemNote(productId) {
        const product = products.find(p => p.id == productId);
        const item = cart[productId];
        if (!product || !item) return;

        // פירוק ההערה הקיימת: כפתורים מוכנים בהתחלה, ואחריהם טקסט חופשי
        const parts = (item.note || '').split(',').map(x => x.trim()).filter(Boolean);
        // הבחירות נשמרות במשתנים בזמן העריכה, ולא נקראות מהחלון אחרי שנסגר
        const chosen = new Set();
        parts.filter(x => NOTE_CHIPS.includes(x)).forEach(x => { if (!chosen.has(NOTE_OPPOSITES[x])) chosen.add(x); });
        let freeText = parts.filter(x => !NOTE_CHIPS.includes(x)).join(', ').slice(0, MAX_NOTE_FREE_TEXT);

        const result = await openDialog({
            title: 'הערה ל' + product.rawName,
            message: 'אפשר לבחור כמה, או לכתוב בעצמך. המלקט יראה את ההערה ליד המוצר.',
            content: (body) => {
                const group = document.createElement('div');
                group.className = 'note-chips';
                group.setAttribute('role', 'group');
                group.setAttribute('aria-label', 'הערות מוכנות');
                NOTE_CHIPS.forEach(chip => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'note-chip';
                    b.textContent = chip;
                    const on = chosen.has(chip);
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                    b.dataset.chip = chip;
                    b.addEventListener('click', () => {
                        const now = b.getAttribute('aria-pressed') !== 'true';
                        b.setAttribute('aria-pressed', now ? 'true' : 'false');
                        b.classList.toggle('active', now);
                        if (now) {
                            chosen.add(chip);
                            // ההפך שלו מתבטל
                            const opposite = NOTE_OPPOSITES[chip];
                            chosen.delete(opposite);
                            const other = group.querySelector('[data-chip="' + opposite + '"]');
                            if (other) {
                                other.setAttribute('aria-pressed', 'false');
                                other.classList.remove('active');
                            }
                        } else {
                            chosen.delete(chip);
                        }
                    });
                    group.appendChild(b);
                });
                const label = document.createElement('label');
                label.className = 'note-free-label';
                label.htmlFor = 'item-note-input';
                label.textContent = 'הערה אחרת (אופציונלי)';
                const input = document.createElement('input');
                input.type = 'text';
                input.id = 'item-note-input';
                input.className = 'note-free-input';
                input.maxLength = MAX_NOTE_FREE_TEXT;
                input.value = freeText;
                input.placeholder = 'למשל: אחד ירוק ואחד אדום';
                input.setAttribute('aria-describedby', 'item-note-count');
                const counter = document.createElement('div');
                counter.id = 'item-note-count';
                counter.className = 'note-count';
                const updateCounter = () => {
                    counter.textContent = 'נשארו ' + (MAX_NOTE_FREE_TEXT - input.value.length) + ' תווים';
                };
                updateCounter();
                input.addEventListener('input', () => { freeText = input.value; updateCounter(); });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); closeDialog('save'); }
                });
                body.append(group, label, input, counter);
            },
            buttons: [
                { label: 'שמירה', value: 'save', kind: 'primary' },
                ...(item.note ? [{ label: 'מחיקת ההערה', value: 'delete', kind: 'secondary' }] : []),
                { label: 'ביטול', value: 'cancel', kind: 'secondary' }
            ],
            cancelValue: 'cancel',
            focusValue: 'save'
        });

        const current = cart[productId];
        if (!current || result === 'cancel') return;
        if (result === 'delete') {
            delete current.note;
        } else {
            const picked = NOTE_CHIPS.filter(c => chosen.has(c)); // תמיד באותו סדר
            const note = cleanNote([...picked, freeText.trim()].filter(Boolean).join(', '));
            if (note) current.note = note; else delete current.note;
        }
        saveCart();
        renderProducts();
        renderCart();
        announce(current.note ? 'ההערה נשמרה: ' + current.note : 'ההערה נמחקה');
    }

    // מתאים את הסל להגבלות הכמות: כמות מעל ההגבלה יורדת להגבלה,
    // ומוצר מוגבל שהיה בסל בק"ג יוצא מהסל (נמכר עכשיו רק ביחידות).
    // מחזיר הודעה ללקוח, או מחרוזת ריקה אם לא השתנה כלום
    function enforceCartLimits(target) {
        const capped = [];
        const removed = [];
        Object.keys(target).forEach(id => {
            const product = products.find(p => p.id == id);
            if (!product || !product.limit) return;
            if (target[id].unit !== UNIT_PIECE) {
                removed.push(product.rawName);
                delete target[id];
            } else if (Number(target[id].qty) > product.limit) {
                target[id].qty = String(product.limit);
                capped.push(product.rawName + ' (עד ' + product.limit + ' יח\')');
            }
        });
        const msgs = [];
        if (capped.length) msgs.push('הכמות עודכנה לפי ההגבלה: ' + capped.join(', ') + '.');
        if (removed.length) msgs.push(removed.join(', ') + ' נמכר' + (removed.length > 1 ? 'ים' : '') + ' כרגע רק ביחידות, ולכן הוסר' + (removed.length > 1 ? 'ו' : '') + ' מהסל. אפשר להוסיף שוב ביחידות.');
        return msgs.join(' ');
    }

    function setDeliveryMethod(method) {
        deliveryMethod = method;
        const btnDelivery = $('btn-delivery');
        const btnPickup = $('btn-pickup');
        const addressGroup = $('address-group');
        const deliveryNotesGroup = $('delivery-notes-group');
        const storeNotesInput = $('cust-store-notes');
        const formTitle = $('checkout-title');

        if (method === 'delivery') {
            if (btnDelivery) btnDelivery.classList.add('active');
            if (btnPickup) btnPickup.classList.remove('active');
            if (addressGroup) addressGroup.classList.remove('hidden');
            if (deliveryNotesGroup) deliveryNotesGroup.classList.remove('hidden');
            const pickupGroup = $('pickup-group');
            if (pickupGroup) pickupGroup.classList.add('hidden');
            clearFieldError('pickup-time');
            if (storeNotesInput) storeNotesInput.placeholder = 'למשל: עגבניות לא בשלות מדי, לארוז בשקית נפרדת...';
            if (formTitle) formTitle.textContent = 'פרטים למשלוח:';
        } else {
            if (btnPickup) btnPickup.classList.add('active');
            if (btnDelivery) btnDelivery.classList.remove('active');
            if (addressGroup) addressGroup.classList.add('hidden');
            if (deliveryNotesGroup) deliveryNotesGroup.classList.add('hidden');
            const pickupGroup = $('pickup-group');
            if (pickupGroup) pickupGroup.classList.remove('hidden');
            renderPickupOptions();
            if (storeNotesInput) storeNotesInput.placeholder = 'למשל: לארוז בשקית נפרדת...';
            if (formTitle) formTitle.textContent = 'פרטי הלקוח לאיסוף:';
            clearFieldError('cust-address');
            clearFieldError('cust-notes');
        }
        updateDeliveryWhen();
        if (btnDelivery) btnDelivery.setAttribute('aria-pressed', method === 'delivery' ? 'true' : 'false');
        if (btnPickup) btnPickup.setAttribute('aria-pressed', method === 'pickup' ? 'true' : 'false');
    }

    function renderCart() {
        const cartItemsContainer = $('cart-items');
        const checkoutForm = $('checkout-form');
        const cartSection = $('cart-section'); // תפסנו את הבלוק המרכזי

        const validItemIds = getValidItemIds();

        // הלקוח הוסיף מוצר בזמן שמסך "ההזמנה התקבלה" עדיין פתוח: זו הזמנה חדשה,
        // ולכן סוגרים את מסך ההצלחה ומציגים סל וטופס רגילים
        if (validItemIds.length > 0 && isSuccessScreenOpen()) {
            closeSuccessScreen(true);
            announce('התחלת הזמנה חדשה');
        }

        if (validItemIds.length === 0) {
            // כשהסל ריק - מסתירים את כל הבלוק של סיכום ההזמנה
            if (cartSection) cartSection.classList.add('hidden');
            checkoutForm.classList.add('hidden');
        } else {
            // כשיש מוצרים - מציגים את הבלוק
            if (cartSection) cartSection.classList.remove('hidden');
            checkoutForm.classList.remove('hidden');

            cartItemsContainer.innerHTML = validItemIds.map(id => {
                const product = products.find(p => p.id == id);
                if(!product) return '';
                const item = cart[id];
                const nameAttr = escapeAttr(product.rawName);

                // שורת מוצר בסל: שם, כמות עם פלוס ומינוס, ופח
                return `
                    <div class="cart-item">
                        <div class="cart-item-name">
                            <img src="${escapeAttr(sizedImage(product.image, 96))}" alt="" class="cart-item-img">
                            <span class="cart-item-title">${product.name}</span>
                        </div>
                        <div class="cart-qty" role="group" aria-label="כמות: ${nameAttr}">
                            <button type="button" class="cart-qty-btn" data-cart-qty="${id}:1" aria-label="הוסף כמות: ${nameAttr}" onclick="changeCartQty(${id}, 1)">+</button>
                            <span class="cart-qty-val">${escapeHTML(item.qty)} ${item.unit}</span>
                            <button type="button" class="cart-qty-btn" data-cart-qty="${id}:-1" aria-label="הפחת כמות: ${nameAttr}" onclick="changeCartQty(${id}, -1)">−</button>
                        </div>
                        <button type="button" onclick="removeItem(${id})" class="remove-btn" title="הסר פריט" aria-label="הסר מהסל: ${nameAttr}">🗑️</button>
                        <div class="cart-item-note">${itemNoteButtonHTML(product, item.note || '', true)}</div>
                    </div>
                `;
            }).join('');
        }

        checkFixedListStatus();
    }

    function removeItem(id) {
        delete cart[id];
        saveCart();
        renderProducts();
        renderCart();
    }

    function checkFixedListStatus() {
        const listActionsCard = $('list-actions-card');
        const saveBtn = $('save-list-btn');
        const loadWrapper = $('load-list-wrapper');
        const clearCartBtn = $('clear-cart-btn');
        const cartSaveBtn = $('cart-save-list-btn');
        const cartBadge = $('cart-badge');
        const topBanner = $('top-list-banner');

        const stickyCartBar = $('sticky-cart-bar');
        const stickyCartText = $('sticky-cart-text');
        const stickyCartAction = $('sticky-cart-action');

        const hasFixedList = !!safeGetItem('rivkin_fixed_list');
        const validItemIds = getValidItemIds();
        const cartHasItems = validItemIds.length > 0;

        if (cartBadge) cartBadge.textContent = validItemIds.length;

        updateHoursCard(cartHasItems);

        if (lastCartCount !== null && lastCartCount !== validItemIds.length) {
            announce(validItemIds.length === 0 ? 'הסל ריק' : 'בסל ' + validItemIds.length + ' פריטים');
        }
        lastCartCount = validItemIds.length;

        // קישור קטן לשמירת רשימה בתוך סיכום ההזמנה
        if (cartSaveBtn) {
            cartSaveBtn.classList.toggle('hidden', !cartHasItems);
            setIconText(cartSaveBtn, hasFixedList ? '🔄 עדכן רשימה קבועה' : '⭐ שמור כרשימה');
        }

        if (clearCartBtn) {
            if (cartHasItems) clearCartBtn.classList.remove('hidden');
            else clearCartBtn.classList.add('hidden');
        }

        // פס קטן בראש הדף במובייל, כדי שלקוח חוזר ימצא את הרשימה שלו מיד
        if (topBanner) topBanner.classList.toggle('hidden', !hasFixedList);

        // לוגיקת הצגת כרטיסיית הרשימה השלמה
        if (listActionsCard) {
            if (!hasFixedList && !cartHasItems) {
                // אין רשימה ואין סל - להסתיר הכל
                listActionsCard.classList.add('hidden');
            } else {
                // יש רשימה או יש סל - להציג את הבלוק הראשי
                listActionsCard.classList.remove('hidden');
            }
        }

        // ניהול הכפתורים הפנימיים
        if (loadWrapper) {
            if (hasFixedList) loadWrapper.classList.remove('hidden');
            else loadWrapper.classList.add('hidden');
        }

        if (saveBtn) {
            if (cartHasItems) {
                saveBtn.classList.remove('hidden');
                setIconText(saveBtn, hasFixedList ? '🔄 עדכן רשימה קבועה' : '⭐ שמור כרשימה');
            } else {
                saveBtn.classList.add('hidden');
            }
        }

        if (stickyCartBar && stickyCartText && stickyCartAction) {
            if (cartHasItems) {
                stickyCartBar.classList.add('active');
                stickyCartBar.classList.remove('suggest-list');
                stickyCartText.innerHTML = `הסל שלך (${validItemIds.length} פריטים)`;
                stickyCartAction.innerHTML = `למעבר לסל &larr;`;
            } else if (!cartHasItems && hasFixedList) {
                stickyCartBar.classList.add('active');
                stickyCartBar.classList.add('suggest-list');
                stickyCartText.innerHTML = `⭐ קיימת רשימה קבועה`;
                stickyCartAction.innerHTML = `לטעינה &larr;`;
            } else {
                stickyCartBar.classList.remove('active');
                stickyCartBar.classList.remove('suggest-list');
            }
        }
    }

    // ==========================================
    // לוח השעות: מתקפל כשיש מוצרים בסל, כדי שסיכום ההזמנה יעלה למעלה
    // ==========================================
    let hoursExpandedByUser = false;

    function updateHoursCard(cartHasItems) {
        const card = $('hours-card');
        if (!card) return;
        if (!cartHasItems) hoursExpandedByUser = false; // סל ריק: חוזרים לברירת המחדל
        card.classList.toggle('collapsed', cartHasItems && !hoursExpandedByUser);
        card.classList.toggle('user-expanded', cartHasItems && hoursExpandedByUser);
        const btn = document.querySelector('.hours-expand-btn');
        if (btn) btn.setAttribute('aria-expanded', hoursExpandedByUser ? 'true' : 'false');
    }

    function focusQuietly(el) {
        if (!el) return;
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }

    function expandHoursCard() {
        hoursExpandedByUser = true;
        updateHoursCard(getValidItemIds().length > 0);
        focusQuietly(document.querySelector('#hours-full .hours-poster-link'));
    }

    function collapseHoursCard() {
        hoursExpandedByUser = false;
        updateHoursCard(getValidItemIds().length > 0);
        focusQuietly(document.querySelector('.hours-expand-btn'));
    }

    // לחיצה על הפס התחתון: עם סל מלא עוברים אליו, עם סל ריק ורשימה קבועה טוענים אותה
    function handleStickyBarClick() {
        if (getValidItemIds().length > 0) {
            scrollToCart();
        } else if (safeGetItem('rivkin_fixed_list')) {
            loadFixedList();
        }
    }

    async function confirmClearCart() {
        const ok = await showConfirm('האם אתה בטוח שברצונך למחוק את כל המוצרים מהעגלה?', {
            title: 'לרוקן את הסל?', confirmLabel: 'כן, רוקן', cancelLabel: 'ביטול', danger: true
        });
        if (ok) {
            cart = {};
            saveCart();
            renderProducts();
            renderCart();
        }
    }

    async function confirmDeleteFixedList() {
        const ok = await showConfirm('האם אתה בטוח שברצונך למחוק את הרשימה השמורה לצמיתות?', {
            title: 'למחוק את הרשימה הקבועה?', confirmLabel: 'כן, מחק', cancelLabel: 'ביטול', danger: true
        });
        if (ok) {
            safeRemoveItem('rivkin_fixed_list');
            checkFixedListStatus();
            showToast('הרשימה הקבועה נמחקה');
        }
    }

    function saveFixedList() {
        const validItemIds = getValidItemIds();
        if (validItemIds.length === 0) return;

        const listToSave = {};
        validItemIds.forEach(id => { listToSave[id] = cart[id]; });

        const saved = safeSetItem('rivkin_fixed_list', JSON.stringify(listToSave));
        if (!saved) {
            showMessage('לא ניתן לשמור את הרשימה במכשיר הזה (ייתכן שהאחסון בדפדפן חסום).', { title: 'לא ניתן לשמור' });
            return;
        }
        showToast('העגלה נשמרה כרשימה הקבועה שלך ⭐');
        checkFixedListStatus();
    }

    function loadFixedList() {
        const buttons = [
            { el: $('load-list-btn'), label: '📥 טען רשימה קבועה' },
            { el: $('top-load-btn'), label: 'טען לעגלה' }
        ].filter(b => b.el);
        buttons.forEach(b => { b.el.disabled = true; b.el.textContent = 'טוען...'; });
        const restoreButtons = () => {
            buttons.forEach(b => { b.el.disabled = false; setIconText(b.el, b.label); });
        };

        setTimeout(async () => {
            const savedList = sanitizeCart(safeParse('rivkin_fixed_list', null));
            const savedIds = Object.keys(savedList);
            if (savedIds.length === 0) {
                restoreButtons();
                // רשימה פגומה או ריקה: מנקים אותה כדי שלא תוצע שוב ושוב
                safeRemoveItem('rivkin_fixed_list');
                checkFixedListStatus();
                await showMessage('לא נמצאה רשימה קבועה תקינה במכשיר הזה.', { title: 'אין רשימה לטעינה' });
                return;
            }

            const limitMsg = enforceCartLimits(savedList);
            const unavailable = [];
            let otherMissingCount = 0;
            let addedCount = 0;

            savedIds.forEach(id => {
                if (!savedList[id]) return; // הוסר בגלל הגבלת כמות (ההודעה מוצגת בסוף)
                const product = products.find(p => p.id == id);
                if (product && isUnitValidForProduct(product, savedList[id].unit)) {
                    cart[id] = savedList[id];
                    addedCount++;
                } else if (unavailableNames[id]) {
                    unavailable.push(unavailableNames[id]);
                } else {
                    otherMissingCount++;
                }
            });

            saveCart();
            renderProducts();
            renderCart();
            restoreButtons();

            if (unavailable.length > 0 || otherMissingCount > 0) {
                let message = addedCount > 0
                    ? 'הרשימה נטענה (הכמויות בעגלה עודכנו).'
                    : 'לא נטען אף מוצר מהרשימה.';
                message += '\n\nלתשומת לבך, המוצרים הבאים אינם זמינים כרגע ולא התווספו:';
                if (unavailable.length > 0) message += '\n' + unavailable.join(', ');
                if (otherMissingCount > 0) message += '\n' + (unavailable.length > 0 ? 'ועוד ' : '') + otherMissingCount + ' מוצרים שאינם נמכרים כרגע באתר.';
                if (limitMsg) message += '\n\n' + limitMsg;
                await showMessage(message, { title: 'חלק מהמוצרים לא נטענו' });
            } else if (limitMsg) {
                await showMessage('הרשימה נטענה.\n\n' + limitMsg, { title: 'הרשימה נטענה' });
            } else if (addedCount > 0) {
                showToast('הרשימה הקבועה נטענה לעגלה ✔');
            }
        }, 400);
    }

    function loadSavedUserDetails() {
        const savedDetails = safeParse('rivkin_user_details', null);
        if (savedDetails && typeof savedDetails === 'object') {
            const nameEl = $('cust-name');
            const phoneEl = $('cust-phone');
            const addressEl = $('cust-address');
            if (typeof savedDetails.name === 'string' && nameEl) nameEl.value = savedDetails.name;
            if (typeof savedDetails.phone === 'string' && phoneEl) phoneEl.value = savedDetails.phone;
            if (typeof savedDetails.address === 'string' && addressEl) addressEl.value = savedDetails.address;
            const emailEl = $('cust-email');
            if (typeof savedDetails.email === 'string' && emailEl) emailEl.value = savedDetails.email;
        }
    }

    // ==========================================
    // מסך הצלחה
    // ==========================================
    // emailInfo: { address, status } כשהלקוח השאיר מייל, אחרת null
    function fillSuccessBox(orderNumber, items, emailInfo, whenText) {
        const whenEl = $('success-when');
        if (whenEl) {
            // "איסוף: יום שני 23/11 בשעה 09:30" / "משלוח: יום חמישי 19/11 בין 18:00–22:00"
            setIconText(whenEl, whenText ? '🕒 ' + whenText : '');
            whenEl.classList.toggle('hidden', !whenText);
        }
        const emailEl = $('success-email-note');
        if (emailEl) {
            emailEl.textContent = '';
            let shown = false;
            if (emailInfo && emailInfo.status === 'sent') {
                // הכתובת בתוך <bdi> כדי שלא תתבלגן בתוך טקסט בעברית
                const addr = document.createElement('bdi');
                addr.textContent = emailInfo.address;
                const mailIcon = document.createElement('span');
                mailIcon.setAttribute('aria-hidden', 'true');
                mailIcon.textContent = '📧 ';
                emailEl.append(mailIcon, 'שלחנו את פרטי ההזמנה למייל ', addr, ' (אם לא הגיע, כדאי לבדוק גם בספאם).');
                shown = true;
            } else if (emailInfo && (emailInfo.status === 'failed' || emailInfo.status === 'skipped')) {
                emailEl.textContent = 'לא הצלחנו לשלוח את פרטי ההזמנה למייל, אבל ההזמנה עצמה התקבלה.';
                shown = true;
            }
            emailEl.classList.toggle('hidden', !shown);
        }
        const numEl = $('success-order-number');
        const listEl = $('success-order-items');
        const wrap = $('success-order-summary');
        if (numEl) {
            if (orderNumber) {
                numEl.textContent = 'מספר הזמנה: ' + orderNumber;
                numEl.classList.remove('hidden');
            } else {
                numEl.textContent = '';
                numEl.classList.add('hidden');
            }
        }
        if (listEl) {
            listEl.innerHTML = '';
            items.forEach(it => {
                const li = document.createElement('li');
                li.textContent = it.name + ' – ' + it.qty + ' ' + it.unit + (it.note ? ' (' + it.note + ')' : '');
                listEl.appendChild(li);
            });
        }
        if (wrap) wrap.classList.toggle('hidden', items.length === 0);
    }

    async function sendOrder() {
        const nameInput = $('cust-name');
        const phoneInput = $('cust-phone');
        const addressInput = $('cust-address');
        const notesInput = $('cust-notes');
        const storeNotesInput = $('cust-store-notes');
        const emailInput = $('cust-email');

        const rawName = nameInput.value.replace(/\s+/g, ' ').trim();
        const rawPhone = phoneInput.value.trim();
        const rawAddress = addressInput.value.replace(/\s+/g, ' ').trim();

        const name = escapeHTML(rawName);
        const address = escapeHTML(rawAddress);
        // הערות לשליח רק במשלוח. הערות לחנות בשתי הדרכים
        const notes = deliveryMethod === 'delivery' ? escapeHTML(notesInput.value.trim()) : '';
        const storeNotes = storeNotesInput ? escapeHTML(storeNotesInput.value.trim()) : '';
        const phone = normalizePhone(rawPhone);
        const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

        const validItemIds = getValidItemIds();
        if (validItemIds.length === 0) { await showMessage('העגלה שלך ריקה.'); return; }

        for (const id of validItemIds) {
            const qtyNum = Number(cart[id].qty);
            if (isNaN(qtyNum) || qtyNum <= 0 || qtyNum > 999) {
                await showMessage('כמות לא תקינה התגלתה בעגלה. אנא תקן.', { title: 'כמות לא תקינה' });
                return;
            }
        }
        const limitFix = enforceCartLimits(cart);
        if (limitFix) {
            saveCart();
            renderProducts();
            renderCart();
            await showMessage(limitFix + '\nאפשר לבדוק את הסל ולשלוח שוב.', { title: 'עדכון בסל' });
            return;
        }

        // בדיקת השדות: כל השגיאות מוצגות יחד, והפוקוס עובר לראשונה
        ['cust-name', 'cust-phone', 'cust-email', 'cust-address', 'cust-notes', 'cust-store-notes', 'pickup-time'].forEach(clearFieldError);
        let firstInvalid = null;
        const fail = (inputId, message) => {
            setFieldError(inputId, message);
            if (!firstInvalid) firstInvalid = inputId;
        };

        if (name.length < 4 || !rawName.includes(' ')) fail('cust-name', 'אנא הכנס שם פרטי ושם משפחה');
        else if (name.length > 50) fail('cust-name', 'השם ארוך מדי (עד 50 תווים)');

        if (!/^05\d{8}$/.test(phone)) fail('cust-phone', 'אנא הכנס מספר נייד ישראלי תקין (10 ספרות, מתחיל ב-05)');

        if (email && (email.length > 100 || !/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(email) || email.includes('..'))) {
            fail('cust-email', 'כתובת המייל לא תקינה (אפשר גם להשאיר את השדה ריק)');
        }

        if (deliveryMethod === 'delivery') {
            if (address.length < 5) fail('cust-address', 'אנא הכנס כתובת מלאה: רחוב ומספר בית');
            else if (address.length > 100) fail('cust-address', 'הכתובת ארוכה מדי (עד 100 תווים)');
        }

        if (notes.length > 500) fail('cust-notes', 'ההערות ארוכות מדי (עד 500 תווים)');
        if (storeNotes.length > 500) fail('cust-store-notes', 'ההערות ארוכות מדי (עד 500 תווים)');

        // איסוף: חייבים לבחור יום ושעה, והשעה צריכה להיות עדיין פנויה (לפחות שעה מעכשיו)
        let pickup = null;
        if (deliveryMethod === 'pickup') {
            const chosenTime = $('pickup-time') ? $('pickup-time').value : '';
            pickup = getPickupSelection();
            if (!pickup) {
                renderPickupOptions();
                fail('pickup-time', chosenTime ? 'השעה שבחרת כבר לא זמינה. אנא בחר שעה אחרת.' : 'אנא בחר יום ושעה לאיסוף');
            }
        }

        if (firstInvalid) {
            focusField(firstInvalid);
            return;
        }

        const finalAddress = deliveryMethod === 'delivery' ? address : '🛍️ איסוף עצמי';

        let orderDetails = '';
        const summaryItems = [];
        const itemNotes = []; // הערה לכל מוצר: { n: השם כמו בשורת ההזמנה, t: ההערה }
        for (const id of validItemIds) {
            const product = products.find(p => p.id == id);
            if (!product) continue;
            orderDetails += `${product.name}: ${cart[id].qty} ${cart[id].unit}\n`;
            summaryItems.push({ name: product.rawName, qty: cart[id].qty, unit: cart[id].unit, note: cart[id].note || '' });
            if (cart[id].note) itemNotes.push({ n: product.name, t: cart[id].note });
        }

        if (summaryItems.length > 100 || orderDetails.length > 3000) {
            await showMessage('ההזמנה ארוכה מדי לשליחה אחת. אפשר לפצל אותה לשתי הזמנות.', { title: 'ההזמנה ארוכה מדי' });
            return;
        }

        const submitBtn = $('submit-order-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'שולח הזמנה...';

        let orderSent = false;
        let orderNumber = null;
        let orderWhen = '';
        let customerEmailStatus = 'none';
        let failureMessage = '';
        let failureTitle = 'ההזמנה לא נשלחה';
        let failureKind = '';
        let warningMessage = '';
        const honeypotEl = $('bot-honeypot');
        const honeypotValue = honeypotEl ? honeypotEl.value : '';
        const uncertainMessage = 'לא התקבל אישור מהשרת, ולכן לא ברור אם ההזמנה נשלחה.\nכדי לא להזמין פעמיים, כדאי לבדוק איתנו בוואטסאפ לפני שליחה חוזרת.\nהסל שלך נשמר.';
        const uncertainTitle = 'לא ברור אם ההזמנה נשלחה';

        try {
            const response = await fetchWithTimeout(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    name: name,
                    phone: phone,
                    email: email,
                    address: finalAddress,
                    notes: notes,
                    storeNotes: storeNotes,
                    itemNotes: itemNotes,
                    pickupDate: pickup ? pickup.date : '',
                    pickupTime: pickup ? pickup.time : '',
                    order: orderDetails,
                    hp: honeypotValue
                })
            }, ORDER_TIMEOUT_MS);

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            let result = null;
            try {
                result = await response.json();
            } catch (parseError) {
                result = null;
            }

            if (result && typeof result.when === 'string') orderWhen = result.when.slice(0, 80);
            if (result && result.status === 'success') {
                orderSent = true;
                orderNumber = result.orderNumber || null;
                customerEmailStatus = result.customerEmail || 'none';
            } else if (result && result.status === 'saved_email_failed') {
                // ההזמנה נשמרה בגיליון אבל המייל לא יצא: הלקוח יודע שנקלטה ומתבקש ליצור קשר
                orderSent = true;
                orderNumber = result.orderNumber || null;
                customerEmailStatus = result.customerEmail || 'none';
                warningMessage = 'הזמנתך נקלטה, אך אירעה תקלה בהודעה אלינו.\nכדי לוודא שהיא טופלה, צור קשר עם החנות בוואטסאפ.\nאין צורך להזמין שוב.';
            } else if (result && result.status === 'duplicate') {
                // אותה הזמנה בדיוק כבר נקלטה לפני רגע: מודיעים ללקוח, אבל לא מאפסים את הדף והסל
                failureTitle = 'הזמנה זהה כבר נקלטה';
                failureMessage = 'הזמנה זהה כבר נקלטה אצלנו לפני רגע, ולכן לא נרשמה שוב.\nאם זו ההזמנה ששלחת, אין צורך לשלוח אותה שוב.\nאם התכוונת להזמין עוד הזמנה, שנה משהו בהזמנה ושלח שוב.';
                if (result.previousStatus === 'saved_email_failed') {
                    failureMessage += '\n\nשים לב: הייתה תקלה בהודעה אלינו על ההזמנה, ולכן כדאי ליצור קשר עם החנות בוואטסאפ כדי לוודא שהיא טופלה.';
                }
            } else if (result && result.status === 'error' && result.code === 'catalog_changed') {
                console.error('Order rejected by catalog check:', result.message);
                failureKind = 'catalog';
                failureTitle = 'חלק מהמוצרים השתנו';
                failureMessage = 'חלק מהמוצרים בהזמנה השתנו באתר מאז שנכנסת.\nרענן את הדף ונסה שוב. הסל שלך נשמר.';
            } else if (result && result.status === 'error' && result.code === 'slot_unavailable') {
                failureKind = 'slot';
                failureTitle = 'השעה לאיסוף לא זמינה';
                failureMessage = 'השעה שבחרת לאיסוף כבר לא זמינה (צריך לפחות שעה להכנת ההזמנה, בשעות הפתיחה).\nאנא בחר שעה אחרת ושלח שוב. הסל שלך נשמר.';
            } else if (result && result.status === 'error' && result.code === 'rate_limited') {
                failureTitle = 'יותר מדי הזמנות';
                failureMessage = 'בוצעו יותר מדי הזמנות בזמן קצר.\nאפשר לנסות שוב בעוד מספר דקות, או לפנות אלינו בוואטסאפ.\nהסל שלך נשמר.';
            } else if (result && result.status === 'error') {
                console.error('Order rejected by server:', result.message);
                failureMessage = 'לא הצלחנו לשלוח את ההזמנה, והיא לא נשלחה אלינו.\nהסל שלך נשמר, אפשר לנסות שוב בעוד רגע.\nאם זה חוזר, אפשר ליצור איתנו קשר בוואטסאפ.';
            } else {
                failureTitle = uncertainTitle;
                failureMessage = uncertainMessage;
            }
        } catch (error) {
            console.error(error);
            failureTitle = uncertainTitle;
            failureMessage = uncertainMessage;
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>שליחת הזמנה</span>';
        }

        if (orderSent) {
            const saveCheckbox = $('save-details-checkbox');
            if (saveCheckbox && saveCheckbox.checked) {
                safeSetItem('rivkin_user_details', JSON.stringify({
                    name: rawName,
                    phone: rawPhone,
                    email: email,
                    address: rawAddress
                }));
            } else {
                safeRemoveItem('rivkin_user_details');
            }

            fillSuccessBox(orderNumber, summaryItems, email ? { address: email, status: customerEmailStatus } : null, orderWhen);

            // שומרים עותק של ההזמנה, כדי שאפשר יהיה לשמור אותה כרשימה קבועה ממסך ההצלחה
            lastOrderList = {};
            validItemIds.forEach(id => {
                lastOrderList[id] = { qty: cart[id].qty, unit: cart[id].unit };
                if (cart[id].note) lastOrderList[id].note = cart[id].note;
            });
            showSuccessSaveButton();

            $('cart-content-wrapper').style.display = 'none';
            const successBox = $('success-box');
            successBox.classList.add('active');
            cart = {};
            saveCart();
            renderProducts(); // הקטלוג מתנקה מהכמויות הישנות
            checkFixedListStatus();
            if (typeof successBox.scrollIntoView === 'function') {
                successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (warningMessage) await showMessage(warningMessage, { title: 'הזמנתך נקלטה' });
        } else if (failureKind === 'slot') {
            renderPickupOptions();
            setFieldError('pickup-time', 'אנא בחר שעה אחרת');
            await showMessage(failureMessage, { title: failureTitle });
            focusField('pickup-time');
        } else if (failureKind === 'catalog') {
            const refresh = await openDialog({
                title: failureTitle,
                message: failureMessage,
                buttons: [
                    { label: 'רענן עכשיו', value: true, kind: 'primary' },
                    { label: 'סגור', value: false, kind: 'secondary' }
                ],
                cancelValue: false,
                focusValue: true
            });
            if (refresh) location.reload();
        } else {
            await showMessage(failureMessage, { title: failureTitle });
        }
    }

    function showSuccessSaveButton() {
        const btn = $('success-save-list-btn');
        if (!btn) return;
        const hasItems = lastOrderList && Object.keys(lastOrderList).length > 0;
        btn.classList.toggle('hidden', !hasItems);
        btn.disabled = false;
        btn.classList.remove('saved');
        setIconText(btn, safeGetItem('rivkin_fixed_list')
            ? '🔄 עדכן את הרשימה הקבועה'
            : '⭐ שמור כרשימה קבועה');
    }

    function saveLastOrderAsList() {
        if (!lastOrderList || Object.keys(lastOrderList).length === 0) return;
        const saved = safeSetItem('rivkin_fixed_list', JSON.stringify(lastOrderList));
        if (!saved) {
            showMessage('לא ניתן לשמור את הרשימה במכשיר הזה (ייתכן שהאחסון בדפדפן חסום).', { title: 'לא ניתן לשמור' });
            return;
        }
        const btn = $('success-save-list-btn');
        if (btn) {
            setIconText(btn, '✔ נשמרה כרשימה הקבועה שלך');
            btn.disabled = true;
            btn.classList.add('saved');
        }
        showToast('בפעם הבאה אפשר לטעון את ההזמנה הזו בלחיצה אחת ⭐', 3800);
        checkFixedListStatus();
    }

    function isSuccessScreenOpen() {
        const box = $('success-box');
        return !!(box && box.classList.contains('active'));
    }

    // סוגר את מסך ההצלחה ומחזיר את טופס ההזמנה, בלי לגעת בסל.
    // keepDeliveryMethod: כשהלקוח פשוט ממשיך לקנות, משאירים את הבחירה שלו (משלוח / איסוף)
    function closeSuccessScreen(keepDeliveryMethod) {
        lastOrderList = null;
        const successSaveBtn = $('success-save-list-btn');
        if (successSaveBtn) successSaveBtn.classList.add('hidden');

        ['cust-notes', 'cust-store-notes'].forEach(id => {
            const el = $(id);
            if (el) el.value = '';
        });

        const hasSavedDetails = !!safeGetItem('rivkin_user_details');
        if (!hasSavedDetails) {
            ['cust-name', 'cust-phone', 'cust-email', 'cust-address'].forEach(id => {
                const el = $(id);
                if (el) el.value = '';
            });
        }
        ['cust-name', 'cust-phone', 'cust-email', 'cust-address', 'cust-notes', 'cust-store-notes', 'pickup-time'].forEach(clearFieldError);
        fillSuccessBox(null, [], null, '');

        $('success-box').classList.remove('active');
        $('cart-content-wrapper').style.display = 'block';

        if (!keepDeliveryMethod) setDeliveryMethod('delivery');
    }

    function resetOrder() {
        cart = {};
        saveCart();
        closeSuccessScreen(false);
        renderProducts();
        renderCart();
    }

    function scrollToCart() {
        const validItemIds = getValidItemIds();
        if (validItemIds.length === 0) {
            showToast('הסל שלך כרגע ריק. בחר ירקות מהקטלוג תחילה 🍅');
            return;
        }
        $('cart-section').scrollIntoView({ behavior: 'smooth' });
    }

    function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

    // ==========================================
    // חלונות תמונה: תעודת הכשרות ולוח השעות
    // ==========================================
    let imageModalLastFocus = null;

    function getOpenImageModal() {
        return document.querySelector('.modal-overlay.active');
    }

    function isKashrutOpen() {
        return !!getOpenImageModal();
    }

    function openImageModal(id) {
        const modal = $(id);
        if (!modal) return;
        // תמונה שמסומנת לטעינה מאוחרת נטענת רק בפתיחה הראשונה
        modal.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        });
        imageModalLastFocus = document.activeElement;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        // הפוקוס עובר לכפתור הסגירה אחרי שהחלון כבר מוצג (אחרת הדפדפן מתעלם, והפוקוס נשאר מאחור)
        const closeBtn = modal.querySelector('.close-modal-btn');
        if (closeBtn) {
            closeBtn.focus();
            requestAnimationFrame(() => setTimeout(() => {
                if (modal.classList.contains('active') && document.activeElement !== closeBtn) closeBtn.focus();
            }, 50));
        }
    }

    function closeImageModal(event) {
        if (event && event.target && event.target.closest('.modal-content') && !event.target.classList.contains('close-modal-btn')) return;
        const modal = getOpenImageModal();
        if (!modal) return;
        modal.classList.remove('active');
        if (!currentDialog) document.body.style.overflow = '';
        const toFocus = imageModalLastFocus;
        imageModalLastFocus = null;
        if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
            try { toFocus.focus(); } catch (e) { /* התעלמות */ }
        }
    }

    function openKashrutModal() { openImageModal('kashrut-modal'); }
    function closeKashrutModal(event) { closeImageModal(event); }
    function openHoursModal() { openImageModal('hours-modal'); }
    function closeHoursModal(event) { closeImageModal(event); }

    window.addEventListener('scroll', () => {
        const btn = $('back-to-top-btn');
        if (btn) btn.classList.toggle('show', window.scrollY > 300);
        updateStickyOffsets();
    }, { passive: true });
    window.addEventListener('resize', updateStickyOffsets);
    window.addEventListener('load', updateStickyOffsets);

    document.addEventListener('keydown', (event) => {
        // חלון הודעות פתוח: Escape סוגר, ו-Tab נשאר בתוך החלון
        if (currentDialog) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog(currentDialog.options.cancelValue);
                return;
            }
            if (event.key === 'Tab') {
                const buttons = getDialogFocusables();
                if (buttons.length === 0) return;
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                const active = document.activeElement;
                if (!buttons.includes(active)) {
                    event.preventDefault();
                    first.focus();
                } else if (event.shiftKey && active === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && active === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
            return;
        }

        if (isKashrutOpen()) {
            if (event.key === 'Escape') {
                closeKashrutModal();
            } else if (event.key === 'Tab') {
                event.preventDefault();
                const openModal = getOpenImageModal();
                const closeBtn = openModal ? openModal.querySelector('.close-modal-btn') : null;
                if (closeBtn) closeBtn.focus();
            }
        }
    });

    // ==========================================
    // כותרת ושורת קטגוריות מוצמדות: מדידת הגובה בפועל
    // ==========================================
    function updateStickyOffsets() {
        const header = document.querySelector('header');
        const bar = $('categories-bar');
        const root = document.documentElement;
        const headerH = header ? Math.round(header.getBoundingClientRect().height) : 93;
        root.style.setProperty('--header-h', headerH + 'px');
        if (bar) {
            root.style.setProperty('--cats-h', Math.round(bar.getBoundingClientRect().height) + 'px');
            // צל עדין רק כשהשורה "נדבקה" למעלה
            bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= headerH + 1 && window.scrollY > 0);
        }
    }

    // אחרי בחירת קטגוריה כשגוללים למטה: חוזרים לתחילת המוצרים של הקטגוריה
    function scrollToCatalogTopIfNeeded() {
        const bar = $('categories-bar');
        const grid = $('products-grid');
        if (!bar || !grid || !bar.classList.contains('stuck')) return;
        const offset = bar.getBoundingClientRect().bottom + 4;
        const target = window.scrollY + grid.getBoundingClientRect().top - offset;
        window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }

    // ==========================================
    // הודעה מחוץ לשעות ההזמנה (לא חוסמת הזמנה, רק מודיעה מתי תטופל)
    // ==========================================
    // סוף קבלת ההזמנות לכל יום (בדקות מחצות). יום שלא מופיע = החנות סגורה.
    // 0 = ראשון ... 6 = שבת
    // ==========================================
    // לוח זמנים: שעות, חגים, ימים מיוחדים, ובחירת מועד לאיסוף
    // (אותו קוד בדיוק כמו ב-Apps Script)
    // ==========================================
    const Sched = (function () {
  // ==========================================
  // לוח הזמנים של החנות. אותו קוד בדיוק נמצא גם באתר וגם ב-Apps Script,
  // כדי ששניהם יחשבו את אותם ימים ושעות.
  // זמנים בדקות מחצות (510 = 08:30). ימים: 0 = ראשון ... 6 = שבת. יום שלא מופיע = סגור.
  // ==========================================
  var WEEK = {
    1: { open: 510, close: 1260, cutoff: 1020, delivery: 'בין 19:00 ל-21:00' },
    2: { open: 510, close: 1260, cutoff: 1020, delivery: 'בין 19:00 ל-21:00' },
    3: { open: 510, close: 1260, cutoff: 1020, delivery: 'בין 18:00 ל-22:00' },
    4: { open: 510, close: 1260, cutoff: 1020, delivery: 'בין 18:00 ל-22:00' },
    5: { open: 510, close: 810, cutoff: 660, delivery: 'בין 13:00 ל-15:00' }
  };
  var SHORT_DAY = WEEK[5];        // ערב חג ו"כמו שישי" = שעות של שישי
  var PICKUP_EARLIEST = 570;      // 09:30: שעת האיסוף הראשונה בכל יום
  var PICKUP_BEFORE_CLOSE = 15;   // איסוף אחרון: רבע שעה לפני הסגירה
  var PREP_MINUTES = 60;          // לפחות שעה מרגע ההזמנה ועד האיסוף
  var SLOT_MINUTES = 15;          // הקפיצות ברשימת השעות
  var PICKUP_DAYS = 3;            // כמה ימי פתיחה קדימה אפשר לבחור לאיסוף
  var DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // ימים טובים בארץ (ראש השנה 2 ימים, יום כיפור, סוכות, שמחת תורה, פסח א' וז', שבועות), 2026 עד 2036.
  // ערב חג (היום שלפני) מחושב לבד. אחרי 2036 צריך להוסיף שנים לרשימה.
  var CHAG = ('20260402 20260408 20260522 20260912 20260913 20260921 20260926 20261003 20270422 20270428 20270611 20271002 20271003 ' +
    '20271011 20271016 20271023 20280411 20280417 20280531 20280921 20280922 20280930 20281005 20281012 20290331 20290406 ' +
    '20290520 20290910 20290911 20290919 20290924 20291001 20300418 20300424 20300607 20300928 20300929 20301007 20301012 ' +
    '20301019 20310408 20310414 20310528 20310918 20310919 20310927 20311002 20311009 20320327 20320402 20320516 20320906 ' +
    '20320907 20320915 20320920 20320927 20330414 20330420 20330603 20330924 20330925 20331003 20331008 20331015 20340404 ' +
    '20340410 20340524 20340914 20340915 20340923 20340928 20341005 20350424 20350430 20350613 20351004 20351005 20351013 ' +
    '20351018 20351025 20360412 20360418 20360601 20360922 20360923 20361001 20361006 20361013').split(' ');
  var CHAG_SET = {};
  for (var c = 0; c < CHAG.length; c++) CHAG_SET[CHAG[c]] = true;

  // --- תאריכים כמחרוזת "20261119" ---
  function toDate(key) { return new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8))); }
  function toKey(d) {
    return d.getUTCFullYear() + ('0' + (d.getUTCMonth() + 1)).slice(-2) + ('0' + d.getUTCDate()).slice(-2);
  }
  function addDays(key, n) { return toKey(new Date(toDate(key).getTime() + n * 86400000)); }
  function weekday(key) { return toDate(key).getUTCDay(); }
  function hhmm(min) { return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); }
  function shortDate(key) { return +key.slice(6, 8) + '/' + +key.slice(4, 6); }

  // special = { "20261124": { m: "closed" | "short", r: "סיבה" } } מהלשונית "ימים מיוחדים"
  // מחזיר את שעות היום, או אובייקט עם closed: true
  function dayInfo(key, special) {
    var sp = special && special[key];
    if (sp && sp.m === 'closed') return { closed: true, reason: sp.r || '' };
    if (CHAG_SET[key]) return { closed: true, reason: 'חג' };
    var base = WEEK[weekday(key)];
    if (!base) return { closed: true, reason: '' };
    var erevChag = !!CHAG_SET[addDays(key, 1)];
    if ((sp && sp.m === 'short') || erevChag) {
      return { open: SHORT_DAY.open, close: SHORT_DAY.close, cutoff: SHORT_DAY.cutoff, delivery: SHORT_DAY.delivery,
               short: true, reason: (sp && sp.r) || (erevChag ? 'ערב חג' : '') };
    }
    return { open: base.open, close: base.close, cutoff: base.cutoff, delivery: base.delivery, short: weekday(key) === 5, reason: '' };
  }

  function isOpenForOrders(key, minutes, special) {
    var info = dayInfo(key, special);
    return !info.closed && minutes < info.cutoff;
  }

  function nextOpenDay(key, special) {
    for (var i = 1; i <= 30; i++) {
      var k = addDays(key, i);
      if (!dayInfo(k, special).closed) return k;
    }
    return addDays(key, 1);
  }

  // היום שבו ההזמנה תטופל (משלוח: היום שבו יגיע): היום, אם לפני שעת הסיום, אחרת יום הפתיחה הבא
  function handlingDay(todayKey, minutes, special) {
    return isOpenForOrders(todayKey, minutes, special) ? todayKey : nextOpenDay(todayKey, special);
  }

  // שעות האיסוף האפשריות ביום מסוים (מערך של דקות)
  function pickupSlots(key, todayKey, minutes, special) {
    var info = dayInfo(key, special);
    if (info.closed) return [];
    var start = Math.max(PICKUP_EARLIEST, info.open);
    if (key === todayKey) {
      if (minutes >= info.cutoff) return [];
      start = Math.max(start, Math.ceil((minutes + PREP_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES);
    }
    var last = info.close - PICKUP_BEFORE_CLOSE;
    var out = [];
    for (var t = start; t <= last; t += SLOT_MINUTES) out.push(t);
    return out;
  }

  // הימים שאפשר לבחור לאיסוף: עד PICKUP_DAYS ימי פתיחה, מהיום (אם עוד אפשר) והלאה
  function pickupDays(todayKey, minutes, special) {
    var days = [];
    for (var i = 0; i <= 30 && days.length < PICKUP_DAYS; i++) {
      var k = addDays(todayKey, i);
      var slots = pickupSlots(k, todayKey, minutes, special);
      if (slots.length) days.push({ key: k, slots: slots });
    }
    return days;
  }

  // "היום, חמישי 19/11" / "מחר, שישי 20/11" / "יום שני 23/11"
  function dayLabel(key, todayKey) {
    var name = DAY_NAMES[weekday(key)];
    if (key === todayKey) return 'היום, ' + name + ' ' + shortDate(key);
    if (key === addDays(todayKey, 1)) return 'מחר, ' + name + ' ' + shortDate(key);
    return 'יום ' + name + ' ' + shortDate(key);
  }

  return {
    dayInfo: dayInfo, handlingDay: handlingDay, nextOpenDay: nextOpenDay, isOpenForOrders: isOpenForOrders,
    pickupSlots: pickupSlots, pickupDays: pickupDays, dayLabel: dayLabel, addDays: addDays, weekday: weekday,
    hhmm: hhmm, shortDate: shortDate, DAY_NAMES: DAY_NAMES, PREP_MINUTES: PREP_MINUTES
  };
})();

    let specialDays = {};   // מהלשונית "ימים מיוחדים" בגיליון (מגיע עם הקטלוג)
    let clockOffsetMs = 0;  // הפרש בין השעון במכשיר לשעון השרת, אם השעון במכשיר לא מכוון

    // עכשיו לפי שעון ישראל: { key: "20261119", minutes: 1005 }
    function israelNow() {
        const now = new Date(Date.now() + clockOffsetMs);
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).formatToParts(now);
            const get = (t) => (parts.find(p => p.type === t) || {}).value;
            const key = get('year') + get('month') + get('day');
            const minutes = Number(get('hour')) * 60 + Number(get('minute'));
            if (/^\d{8}$/.test(key) && isFinite(minutes)) return { key, minutes };
        } catch (e) { /* נופלים לשעון המכשיר */ }
        const d = now;
        const key = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
        return { key, minutes: d.getHours() * 60 + d.getMinutes() };
    }

    // הנתונים שהשרת מוסיף בסוף הקטלוג (ימים מיוחדים ושעת השרת)
    function applyScheduleMeta(meta, fromCache) {
        if (!meta || typeof meta !== 'object') return;
        if (meta.special && typeof meta.special === 'object') {
            const clean = {};
            Object.keys(meta.special).forEach(k => {
                const v = meta.special[k];
                if (/^\d{8}$/.test(k) && v && (v.m === 'closed' || v.m === 'short')) {
                    clean[k] = { m: v.m, r: typeof v.r === 'string' ? v.r.slice(0, 60) : '' };
                }
            });
            specialDays = clean;
        }
        // רק שעה מקטלוג עדכני. הפרש קטן מ-2 דקות לא משנה כלום
        if (!fromCache && typeof meta.now === 'number') {
            const diff = meta.now - Date.now();
            // הפרש של יותר מיממה וחצי הוא כנראה תקלה, ולא שעון לא מכוון: מתעלמים
            clockOffsetMs = (Math.abs(diff) > 2 * 60000 && Math.abs(diff) < 36 * 3600000) ? diff : 0;
        }
        updateOrderHoursNotice();
    }

    // "מחר, שישי 20/11" / "ביום שני 23/11"
    function whenPhrase(key, todayKey) {
        if (key === Sched.addDays(todayKey, 1)) return 'מחר (יום ' + Sched.DAY_NAMES[Sched.weekday(key)] + ' ' + Sched.shortDate(key) + ')';
        return 'ביום ' + Sched.DAY_NAMES[Sched.weekday(key)] + ' ' + Sched.shortDate(key);
    }

    // ההודעה הצהובה: חנות סגורה / הזמנות נסגרו / שעות מקוצרות. null = יום רגיל
    function getOrderHoursMessage() {
        const { key, minutes } = israelNow();
        const info = Sched.dayInfo(key, specialDays);
        const reason = info.reason && info.reason !== 'חג' ? ' (' + info.reason + ')' : '';
        if (info.closed) {
            const next = Sched.nextOpenDay(key, specialDays);
            let opening;
            if (Sched.weekday(key) === 6) opening = 'שבת שלום! ';
            else if (info.reason === 'חג') opening = 'חג שמח! החנות סגורה היום. ';
            else opening = 'החנות סגורה היום' + reason + '. ';
            return opening + 'הזמנה שתישלח עכשיו תטופל ' + whenPhrase(next, key) + ' מ־' + Sched.hhmm(Sched.dayInfo(next, specialDays).open) + '.';
        }
        // לילה, לפני הפתיחה: אפשר כבר להזמין, וההזמנה תטופל היום
        if (minutes < info.open) {
            // רווח שלא נשבר בין "היום" לשעה, כדי שהשעה לא תתחיל שורה לבד
            return 'החנות נפתחת היום\u00A0ב-' + Sched.hhmm(info.open) + '. אפשר כבר להזמין!';
        }
        if (minutes >= info.cutoff) {
            const next = Sched.nextOpenDay(key, specialDays);
            return 'ההזמנות להיום נסגרו. הזמנה שתישלח עכשיו תטופל ' + whenPhrase(next, key) + '.';
        }
        if (info.short && Sched.weekday(key) !== 5) {
            return 'היום שעות מקוצרות' + reason + ': הזמנות עד ' + Sched.hhmm(info.cutoff) + ', משלוחים ' + info.delivery + ', החנות פתוחה עד ' + Sched.hhmm(info.close) + '.';
        }
        return null;
    }

    // הפס הירוק העליון: שעת סיום ההזמנות של היום (בשישי ובערב חג 11:00)
    function updateAnnouncementOrders() {
        const el = $('ann-orders');
        if (!el) return;
        const { key } = israelNow();
        const info = Sched.dayInfo(key, specialDays);
        const html = (!info.closed && info.short)
            ? '<span aria-hidden="true">📋</span> הזמנות <span class="ann-long">מתקבלות </span>היום עד <span class="ann-long">השעה </span>' + Sched.hhmm(info.cutoff)
            : '<span aria-hidden="true">📋</span> הזמנות <span class="ann-long">מתקבלות </span>עד <span class="ann-long">השעה </span>17:00';
        if (el.innerHTML !== html) el.innerHTML = html;
    }

    // השורה "המשלוח יגיע..." בטופס
    function updateDeliveryWhen() {
        const el = $('delivery-when');
        if (!el) return;
        if (deliveryMethod !== 'delivery') { el.textContent = ''; el.classList.add('hidden'); return; }
        const { key, minutes } = israelNow();
        const day = Sched.handlingDay(key, minutes, specialDays);
        const info = Sched.dayInfo(day, specialDays);
        const when = day === key ? 'היום' : whenPhrase(day, key);
        setIconText(el, '🚚 המשלוח יגיע ' + when + ' ' + info.delivery + '.');
        el.classList.remove('hidden');
    }

    // רשימות היום והשעה לאיסוף. שומר על הבחירה הקיימת אם היא עדיין אפשרית
    function renderPickupOptions() {
        const daySel = $('pickup-day');
        const timeSel = $('pickup-time');
        if (!daySel || !timeSel) return;
        const { key, minutes } = israelNow();
        const days = Sched.pickupDays(key, minutes, specialDays);
        const prevDay = daySel.value;
        daySel.innerHTML = days.map(d => `<option value="${d.key}">${escapeHTML(Sched.dayLabel(d.key, key))}</option>`).join('');
        if (days.some(d => d.key === prevDay)) daySel.value = prevDay;
        renderPickupTimes();
    }

    function renderPickupTimes() {
        const daySel = $('pickup-day');
        const timeSel = $('pickup-time');
        if (!daySel || !timeSel) return;
        const { key, minutes } = israelNow();
        const slots = daySel.value ? Sched.pickupSlots(daySel.value, key, minutes, specialDays) : [];
        const prev = timeSel.value;
        timeSel.innerHTML = '<option value="">בחר שעה</option>' + slots.map(t => `<option value="${Sched.hhmm(t)}">${Sched.hhmm(t)}</option>`).join('');
        if (slots.some(t => Sched.hhmm(t) === prev)) timeSel.value = prev;
    }

    function onPickupDayChange() {
        renderPickupTimes();
        clearFieldError('pickup-time');
    }

    // הבחירה הנוכחית, אם היא עדיין אפשרית: { date, time } או null
    function getPickupSelection() {
        const daySel = $('pickup-day');
        const timeSel = $('pickup-time');
        if (!daySel || !timeSel || !daySel.value || !timeSel.value) return null;
        const { key, minutes } = israelNow();
        const slots = Sched.pickupSlots(daySel.value, key, minutes, specialDays).map(Sched.hhmm);
        if (!slots.includes(timeSel.value)) return null;
        return { date: daySel.value, time: timeSel.value, label: Sched.dayLabel(daySel.value, key) + ' בשעה ' + timeSel.value };
    }

    function updateOrderHoursNotice() {
        updateAnnouncementOrders();
        const message = getOrderHoursMessage();
        ['order-hours-notice', 'checkout-hours-notice'].forEach(id => {
            const el = $(id);
            if (!el) return;
            setIconText(el, message ? '🕒 ' + message : '');
            el.classList.toggle('hidden', !message);
        });
        updateDeliveryWhen();
        renderPickupOptions();
    }

    window.filterCategory = filterCategory;
    window.handleSearch = handleSearch;
    window.clearSearch = clearSearch;
    window.setQuickQty = setQuickQty;
    window.changeQty = changeQty;
    window.updateCartItem = updateCartItem;
    window.updateCartUnit = updateCartUnit;
    window.removeItem = removeItem;
    window.sendOrder = sendOrder;
    window.resetOrder = resetOrder;
    window.scrollToCart = scrollToCart;
    window.scrollToTop = scrollToTop;
    window.openKashrutModal = openKashrutModal;
    window.closeKashrutModal = closeKashrutModal;
    window.openHoursModal = openHoursModal;
    window.expandHoursCard = expandHoursCard;
    window.collapseHoursCard = collapseHoursCard;
    window.closeHoursModal = closeHoursModal;
    window.setDeliveryMethod = setDeliveryMethod;
    window.saveFixedList = saveFixedList;
    window.loadFixedList = loadFixedList;
    window.confirmClearCart = confirmClearCart;
    window.confirmDeleteFixedList = confirmDeleteFixedList;
    window.retryLoadProducts = retryLoadProducts;
    window.handleStickyBarClick = handleStickyBarClick;
    window.saveLastOrderAsList = saveLastOrderAsList;
    window.changeCartQty = changeCartQty;
    window.editItemNote = editItemNote;
    window.onPickupDayChange = onPickupDayChange;

    function init() {
        // שגיאה בשדה נעלמת ברגע שהלקוח מתחיל לתקן
        ['cust-name', 'cust-phone', 'cust-email', 'cust-address', 'cust-notes', 'cust-store-notes', 'pickup-time'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener(id === 'pickup-time' ? 'change' : 'input', () => clearFieldError(id));
        });

        // "בכשרות מהודרת" ו"שעות פעילות" בכותרת הם כפתורים רגילים, ולכן עובדים במקלדת בלי טיפול נוסף
        const sticky = $('sticky-cart-bar');
        if (sticky) {
            sticky.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStickyBarClick(); }
            });
        }

        // Enter בחיפוש סוגר את המקלדת במובייל
        const searchInput = $('search-input');
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); searchInput.blur(); }
            });
        }

        // לחיצה על הרקע סוגרת את חלון ההודעות
        const overlay = $('app-dialog');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && currentDialog) closeDialog(currentDialog.options.cancelValue);
            });
        }

        setDeliveryMethod('delivery');

        // גובה הכותרת משתנה (טעינת הלוגו, סיבוב מסך), ולכן נמדד מחדש כשהוא משתנה
        updateStickyOffsets();
        const headerEl = document.querySelector('header');
        if (headerEl && typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(updateStickyOffsets).observe(headerEl);
        }

        // הודעת השעות מתעדכנת כל דקה, גם כשהדף נשאר פתוח
        updateOrderHoursNotice();
        setInterval(updateOrderHoursNotice, 60000);
    }

    init();
    loadSavedUserDetails();
    loadProducts();
})();
// ==========================================
// חזרה מהתקנון: הלקוח חוזר לאותו מקום בדף שבו לחץ על הקישור.
// הדפדפן לא מצליח לעשות את זה לבד, כי הקטלוג נטען מגוגל רק אחרי שהדף עולה,
// ובאותו רגע הדף עדיין קצר מדי. לכן שומרים את המיקום בלחיצה על הקישור,
// ומחזירים אותו כשהדף חוזר ויש מספיק תוכן.
// ==========================================
(function () {
    const KEY = 'rivkin-return-scroll';
    const MAX_AGE = 30 * 60 * 1000; // חצי שעה: אחרי זה כבר לא "חזרה", אלא כניסה חדשה

    // לחיצה על קישור לתקנון באותה לשונית: שומרים איפה הלקוח היה
    document.addEventListener('click', (e) => {
        const link = e.target.closest && e.target.closest('a[href^="terms.html"]');
        if (!link || link.target === '_blank') return;
        try { sessionStorage.setItem(KEY, JSON.stringify({ y: Math.round(window.scrollY), t: Date.now() })); } catch (err) {}
    });

    function takeSaved() {
        try {
            const raw = sessionStorage.getItem(KEY);
            sessionStorage.removeItem(KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !(data.y > 0) || Date.now() - data.t > MAX_AGE) return null;
            return data.y;
        } catch (err) { return null; }
    }

    // הדפדפן החזיר את הדף מהזיכרון כמו שהוא: המיקום כבר נכון, רק מנקים
    window.addEventListener('pageshow', (e) => { if (e.persisted) takeSaved(); });

    const y = takeSaved();
    if (y === null) return;

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    // אם הלקוח התחיל לגלול בעצמו, לא מזיזים לו את הדף
    let userMoved = false;
    const stop = () => { userMoved = true; };
    ['wheel', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, stop, { once: true, passive: true }));

    const started = Date.now();
    (function tryRestore() {
        if (userMoved) return;
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        // מחכים שהדף יהיה ארוך מספיק (הקטלוג נטען), עד 4 שניות לכל היותר
        if (maxY >= y - 2 || Date.now() - started > 4000) {
            window.scrollTo({ top: Math.min(y, Math.max(0, maxY)), behavior: 'instant' });
            return;
        }
        setTimeout(tryRestore, 50);
    })();
})();