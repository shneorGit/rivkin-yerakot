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
        }
        return clean;
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

    const escapeHTML = (str) => {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    };

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
        titleEl.textContent = next.options.title || '';
        messageEl.textContent = next.options.message || '';
        actionsEl.innerHTML = '';

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
            const kashrut = $('kashrut-modal');
            if (!(kashrut && kashrut.classList.contains('active'))) document.body.style.overflow = '';
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

        let numericPrice = parseFloat(String(item['מחיר'] || '').replace(/[₪,]/g, '')) || 0;
        const categoryRaw = item['קטגוריה'] ? String(item['קטגוריה']).trim() : '';

        const p = {
            id: Number(item['מזהה']),
            name: escapeHTML(item['שם']),
            rawName: String(item['שם'] || '').trim(),
            isNew: String(item['חדש'] || '').trim() === 'כן',
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

    async function loadProducts() {
        try {
            const response = await fetchWithTimeout(SCRIPT_URL, {}, LOAD_TIMEOUT_MS);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error('Unexpected catalog response');

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
            reconcileCartWithCatalog();

            renderCategories();
            renderProducts();
            renderCart();
        } catch (error) {
            console.error('Error loading products:', error);
            renderLoadError();
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

        const unitLabel = (isBoth || isKgOnly) ? 'לק״ג' : 'ליחידה';
        const isInCart = currentItem.qty !== '' && Number(currentItem.qty) > 0;

        return `
            <div id="card-${p.id}" class="product-card ${isInCart ? 'in-cart' : ''}">
                <div class="product-img-container">
                    <img src="${escapeAttr(p.image)}" alt="${nameAttr}" class="product-img" loading="lazy">
                </div>
                <div class="product-info">
                    <div>
                        <div class="product-name">${p.name}</div>
                        <div class="product-price">₪${p.price.toFixed(2)} ${unitLabel}</div>
                    </div>
                    <div class="product-actions-wrapper">
                        ${quickButtonsHTML}
                        <div class="card-action-row ${isBoth ? 'has-toggle' : ''}">
                            <div class="quantity-control">
                                <button type="button" class="qty-btn" aria-label="הוסף כמות: ${nameAttr}" onclick="changeQty(${p.id}, 1)">+</button>
                                <input type="number" step="${inputStep}" min="0" inputmode="${inputMode}" id="qty-${p.id}" placeholder="0"
                                    aria-label="כמות: ${nameAttr}"
                                    value="${escapeAttr(qtyVal)}" oninput="updateCartItem(${p.id}, this.value)"
                                    class="product-input">
                                <button type="button" class="qty-btn" aria-label="הפחת כמות: ${nameAttr}" onclick="changeQty(${p.id}, -1)">−</button>
                            </div>
                            ${unitSelectorHTML}
                        </div>
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
                    <img src="${escapeAttr(p.image)}" alt="${nameAttr}" class="product-img" loading="lazy">
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

        cart[productId] = { qty: qty, unit: unit };
        saveCart();
        renderProducts();
        renderCart();
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

        if (isDecimalAllowed) newQty = Math.round(newQty * 10) / 10;

        updateCartItem(productId, newQty === 0 ? '' : newQty.toString());
    }

    function updateCartItem(productId, value) {
        const product = products.find(p => p.id == productId);
        if (!product || !product.inStock) return;

        let unit = 'יח\'';
        if (product.unitType === 'kg') unit = 'ק״ג';
        else if (product.unitType === 'both') unit = cart[productId]?.unit || 'יח\'';

        let finalVal = value;
        if (unit !== 'ק״ג' && value.includes('.')) {
            finalVal = Math.floor(Number(value)).toString();
        }

        if (String(finalVal).trim() === '' || Number(finalVal) <= 0) {
            delete cart[productId];
        } else {
            cart[productId] = { qty: finalVal, unit: unit };
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
        cart[productId] = { qty: '', unit: newUnit };
        saveCart();
        renderProducts();
        renderCart();
    }

    function setDeliveryMethod(method) {
        deliveryMethod = method;
        const btnDelivery = $('btn-delivery');
        const btnPickup = $('btn-pickup');
        const addressGroup = $('address-group');
        const notesLabel = $('notes-label');
        const notesInput = $('cust-notes');
        const formTitle = $('checkout-title');

        if (method === 'delivery') {
            if (btnDelivery) btnDelivery.classList.add('active');
            if (btnPickup) btnPickup.classList.remove('active');
            if (addressGroup) addressGroup.classList.remove('hidden');
            if (notesLabel) notesLabel.textContent = 'הערות לשליח (אופציונלי)';
            if (notesInput) notesInput.placeholder = 'למשל: קומה 2, דירה 4, להניח ליד הדלת...';
            if (formTitle) formTitle.textContent = 'פרטים למשלוח:';
        } else {
            if (btnPickup) btnPickup.classList.add('active');
            if (btnDelivery) btnDelivery.classList.remove('active');
            if (addressGroup) addressGroup.classList.add('hidden');
            if (notesLabel) notesLabel.textContent = 'הערות / מתי תגיע לאסוף?';
            if (notesInput) notesInput.placeholder = 'למשל: אגיע לאסוף סביב השעה 16:00...';
            if (formTitle) formTitle.textContent = 'פרטי הלקוח לאיסוף:';
            clearFieldError('cust-address');
        }
        if (btnDelivery) btnDelivery.setAttribute('aria-pressed', method === 'delivery' ? 'true' : 'false');
        if (btnPickup) btnPickup.setAttribute('aria-pressed', method === 'pickup' ? 'true' : 'false');
    }

    function renderCart() {
        const cartItemsContainer = $('cart-items');
        const checkoutForm = $('checkout-form');
        const cartSection = $('cart-section'); // תפסנו את הבלוק המרכזי

        const validItemIds = getValidItemIds();

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

                return `
                    <div class="cart-item">
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
                            <img src="${escapeAttr(product.image)}" alt="" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                            <span style="font-weight: 500; color: #1e293b; line-height: 1.2;">${product.name}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <span style="background: #dcfce7; color: #15803d; padding: 0.125rem 0.5rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: bold;">${escapeHTML(item.qty)} ${item.unit}</span>
                            <button type="button" onclick="removeItem(${id})" class="remove-btn" title="הסר פריט" aria-label="הסר מהסל: ${escapeAttr(product.rawName)}">🗑️</button>
                        </div>
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
        const cartBadge = $('cart-badge');
        const topBanner = $('top-list-banner');

        const stickyCartBar = $('sticky-cart-bar');
        const stickyCartText = $('sticky-cart-text');
        const stickyCartAction = $('sticky-cart-action');

        const hasFixedList = !!safeGetItem('rivkin_fixed_list');
        const validItemIds = getValidItemIds();
        const cartHasItems = validItemIds.length > 0;

        if (cartBadge) cartBadge.textContent = validItemIds.length;

        if (lastCartCount !== null && lastCartCount !== validItemIds.length) {
            announce(validItemIds.length === 0 ? 'הסל ריק' : 'בסל ' + validItemIds.length + ' פריטים');
        }
        lastCartCount = validItemIds.length;

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
                saveBtn.innerHTML = hasFixedList ? '🔄 עדכן רשימה קבועה' : '⭐ שמור כרשימה';
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
            buttons.forEach(b => { b.el.disabled = false; b.el.textContent = b.label; });
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

            const unavailable = [];
            let otherMissingCount = 0;
            let addedCount = 0;

            savedIds.forEach(id => {
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
                await showMessage(message, { title: 'חלק מהמוצרים לא נטענו' });
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
        }
    }

    // ==========================================
    // מסך הצלחה
    // ==========================================
    function fillSuccessBox(orderNumber, items) {
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
                li.textContent = it.name + ' – ' + it.qty + ' ' + it.unit;
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

        const rawName = nameInput.value.replace(/\s+/g, ' ').trim();
        const rawPhone = phoneInput.value.trim();
        const rawAddress = addressInput.value.replace(/\s+/g, ' ').trim();

        const name = escapeHTML(rawName);
        const address = escapeHTML(rawAddress);
        const notes = escapeHTML(notesInput.value.trim());
        const phone = normalizePhone(rawPhone);

        const validItemIds = getValidItemIds();
        if (validItemIds.length === 0) { await showMessage('העגלה שלך ריקה.'); return; }

        for (const id of validItemIds) {
            const qtyNum = Number(cart[id].qty);
            if (isNaN(qtyNum) || qtyNum <= 0 || qtyNum > 999) {
                await showMessage('כמות לא תקינה התגלתה בעגלה. אנא תקן.', { title: 'כמות לא תקינה' });
                return;
            }
        }

        // בדיקת השדות: כל השגיאות מוצגות יחד, והפוקוס עובר לראשונה
        ['cust-name', 'cust-phone', 'cust-address', 'cust-notes'].forEach(clearFieldError);
        let firstInvalid = null;
        const fail = (inputId, message) => {
            setFieldError(inputId, message);
            if (!firstInvalid) firstInvalid = inputId;
        };

        if (name.length < 4 || !rawName.includes(' ')) fail('cust-name', 'אנא הכנס שם פרטי ושם משפחה');
        else if (name.length > 50) fail('cust-name', 'השם ארוך מדי (עד 50 תווים)');

        if (!/^05\d{8}$/.test(phone)) fail('cust-phone', 'אנא הכנס מספר נייד ישראלי תקין (10 ספרות, מתחיל ב-05)');

        if (deliveryMethod === 'delivery') {
            if (address.length < 5) fail('cust-address', 'אנא הכנס כתובת מלאה: רחוב ומספר בית');
            else if (address.length > 100) fail('cust-address', 'הכתובת ארוכה מדי (עד 100 תווים)');
        }

        if (notes.length > 500) fail('cust-notes', 'ההערות ארוכות מדי (עד 500 תווים)');

        if (firstInvalid) {
            focusField(firstInvalid);
            return;
        }

        const finalAddress = deliveryMethod === 'delivery' ? address : '🛍️ איסוף עצמי';

        let orderDetails = '';
        const summaryItems = [];
        for (const id of validItemIds) {
            const product = products.find(p => p.id == id);
            if (!product) continue;
            orderDetails += `${product.name}: ${cart[id].qty} ${cart[id].unit}\n`;
            summaryItems.push({ name: product.rawName, qty: cart[id].qty, unit: cart[id].unit });
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
                    address: finalAddress,
                    notes: notes,
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

            if (result && result.status === 'success') {
                orderSent = true;
                orderNumber = result.orderNumber || null;
            } else if (result && result.status === 'saved_email_failed') {
                // ההזמנה נשמרה בגיליון אבל המייל לא יצא: הלקוח יודע שנקלטה ומתבקש ליצור קשר
                orderSent = true;
                orderNumber = result.orderNumber || null;
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
                    address: rawAddress
                }));
            } else {
                safeRemoveItem('rivkin_user_details');
            }

            fillSuccessBox(orderNumber, summaryItems);
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

    function resetOrder() {
        cart = {};
        saveCart();

        const notesEl = $('cust-notes');
        if (notesEl) notesEl.value = '';

        const hasSavedDetails = !!safeGetItem('rivkin_user_details');
        if (!hasSavedDetails) {
            ['cust-name', 'cust-phone', 'cust-address'].forEach(id => {
                const el = $(id);
                if (el) el.value = '';
            });
        }
        ['cust-name', 'cust-phone', 'cust-address', 'cust-notes'].forEach(clearFieldError);
        fillSuccessBox(null, []);

        $('success-box').classList.remove('active');
        $('cart-content-wrapper').style.display = 'block';

        setDeliveryMethod('delivery');

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
    // חלון תעודת הכשרות
    // ==========================================
    let kashrutLastFocus = null;

    function isKashrutOpen() {
        const modal = $('kashrut-modal');
        return !!(modal && modal.classList.contains('active'));
    }

    function openKashrutModal() {
        const modal = $('kashrut-modal');
        if (!modal) return;
        kashrutLastFocus = document.activeElement;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        const closeBtn = modal.querySelector('.close-modal-btn');
        if (closeBtn) closeBtn.focus();
    }

    function closeKashrutModal(event) {
        if (event && event.target && event.target.closest('.modal-content') && !event.target.classList.contains('close-modal-btn')) return;
        const modal = $('kashrut-modal');
        if (!modal || !modal.classList.contains('active')) return;
        modal.classList.remove('active');
        if (!currentDialog) document.body.style.overflow = '';
        const toFocus = kashrutLastFocus;
        kashrutLastFocus = null;
        if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
            try { toFocus.focus(); } catch (e) { /* התעלמות */ }
        }
    }

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
                const buttons = getDialogButtons();
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
                const closeBtn = document.querySelector('#kashrut-modal .close-modal-btn');
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
    const ORDER_CUTOFF = { 1: 17 * 60, 2: 17 * 60, 3: 17 * 60, 4: 17 * 60, 5: 11 * 60 };
    const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

    // השעה והיום לפי שעון ישראל, גם אם השעון במכשיר של הלקוח מוגדר אחרת
    function israelNow() {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).formatToParts(new Date());
            const get = (t) => (parts.find(p => p.type === t) || {}).value;
            const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
            const minutes = Number(get('hour')) * 60 + Number(get('minute'));
            if (day >= 0 && isFinite(minutes)) return { day, minutes };
        } catch (e) { /* נופלים לשעון המכשיר */ }
        const d = new Date();
        return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
    }

    // מחזיר טקסט הודעה, או null כשההזמנה תטופל היום
    function getOrderHoursMessage() {
        const { day, minutes } = israelNow();
        if (ORDER_CUTOFF[day] !== undefined && minutes < ORDER_CUTOFF[day]) return null;

        let next = day;
        let daysAhead = 0;
        do { next = (next + 1) % 7; daysAhead++; } while (ORDER_CUTOFF[next] === undefined && daysAhead < 7);

        const when = next === 5 ? 'ביום שישי בבוקר' : 'ביום ' + DAY_NAMES[next] + ' מ־09:00';
        let opening;
        if (day === 6) opening = 'שבת שלום! ';
        else if (ORDER_CUTOFF[day] === undefined) opening = 'החנות סגורה היום. ';
        else opening = 'ההזמנות להיום נסגרו. ';
        return opening + 'הזמנה שתישלח עכשיו תטופל ' + when + '.';
    }

    function updateOrderHoursNotice() {
        const message = getOrderHoursMessage();
        ['order-hours-notice', 'checkout-hours-notice'].forEach(id => {
            const el = $(id);
            if (!el) return;
            el.textContent = message ? '🕒 ' + message : '';
            el.classList.toggle('hidden', !message);
        });
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
    window.setDeliveryMethod = setDeliveryMethod;
    window.saveFixedList = saveFixedList;
    window.loadFixedList = loadFixedList;
    window.confirmClearCart = confirmClearCart;
    window.confirmDeleteFixedList = confirmDeleteFixedList;
    window.retryLoadProducts = retryLoadProducts;
    window.handleStickyBarClick = handleStickyBarClick;

    function init() {
        // שגיאה בשדה נעלמת ברגע שהלקוח מתחיל לתקן
        ['cust-name', 'cust-phone', 'cust-address', 'cust-notes'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('input', () => clearFieldError(id));
        });

        // קישור הכשרות והפס התחתון נגישים גם במקלדת
        document.querySelectorAll('.kashrut-link').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openKashrutModal(); }
            });
        });
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