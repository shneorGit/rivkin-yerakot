(() => {
    // 1. State Management (עם טעינה מה-LocalStorage)
    let products = [];
    let cart = JSON.parse(localStorage.getItem('rivkin_cart')) || {};
    let currentCategory = 'הכל';
    let searchQuery = ''; 
    let deliveryMethod = 'delivery'; // <-- חדש: שומר את שיטת הקבלה (דיפולט משלוח)

    // 2. פונקציית עזר לאבטחת מידע (XSS Prevention)
    const escapeHTML = (str) => {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    };

    // 3. שמירת מצב העגלה
    const saveCart = () => {
        localStorage.setItem('rivkin_cart', JSON.stringify(cart));
    };

    async function loadProducts() {
        const sheetDbUrl = 'https://script.google.com/macros/s/AKfycbynKmEjuR0AyRVoXuRcEvN_4b32ggSnhlbZ9iaRtvpJcJUV8NeKizNODCyU5_9b3oHq8Q/exec'; 

        try {
            const response = await fetch(sheetDbUrl);
            const data = await response.json();
            
            products = data.map(item => {
                let stockVal = String(item['במלאי'] || '').trim().toLowerCase();
                let isAvailable = !['לא', 'false', '0', 'no'].includes(stockVal);

                let rawUnit = String(item['סוג יחידה'] || '').trim();
                let mappedUnit = 'both'; 
                if (rawUnit === 'יחידות בלבד') mappedUnit = 'unit';
                else if (rawUnit === 'ק"ג בלבד') mappedUnit = 'kg';

                let numericPrice = parseFloat(String(item['מחיר'] || '').replace(/[₪,]/g, '')) || 0;

                return {
                    id: Number(item['מזהה']),
                    name: escapeHTML(item['שם']), // חיטוי טקסט
                    price: numericPrice,
                    category: item['קטגוריה'] ? escapeHTML(item['קטגוריה'].trim()) : 'כללי',
                    unitType: mappedUnit,
                    image: item['תמונה'], 
                    inStock: isAvailable
                };
            });

            products = products.filter(p => p.inStock);

            renderCategories();
            renderProducts();
            renderCart(); 
        } catch (error) {
            console.error('Error loading products:', error);
            document.getElementById('products-grid').innerHTML = '<p style="grid-column: span 2; text-align: center; color: #ef4444; padding: 2rem;">שגיאה בטעינת המוצרים מהחנות. בדוק את חיבור ה-API.</p>';
        }
    }

    function renderCategories() {
        const categoriesBar = document.getElementById('categories-bar');
        const categories = ['הכל', ...new Set(products.map(p => p.category))];

        categoriesBar.innerHTML = categories.map(cat => `
            <button class="category-tab ${currentCategory === cat ? 'active' : ''}" onclick="filterCategory('${cat}', this)">${cat}</button>
        `).join('');
    }

    function filterCategory(category, btnElement) {
        currentCategory = category;
        document.querySelectorAll('.category-tab').forEach(btn => btn.classList.remove('active'));
        if (btnElement) btnElement.classList.add('active');
        renderProducts();
    }

    function handleSearch(query) {
        searchQuery = query.trim().toLowerCase();
        
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) {
            clearBtn.style.display = searchQuery.length > 0 ? 'flex' : 'none';
        }
        
        renderProducts();
    }

    function clearSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
            handleSearch(''); 
            searchInput.focus(); 
        }
    }

    function renderProducts() {
        const grid = document.getElementById('products-grid');
        
        const filteredProducts = products.filter(p => {
            const matchesCategory = currentCategory === 'הכל' || p.category === currentCategory;
            const matchesSearch = p.name.toLowerCase().includes(searchQuery);
            return matchesCategory && matchesSearch;
        });

        if (filteredProducts.length === 0) {
            grid.innerHTML = '<p style="grid-column: span 2; text-align: center; padding: 2rem; color: #64748b;">לא נמצאו מוצרים תואמים לחיפוש שלך.</p>';
            return;
        }

        grid.innerHTML = filteredProducts.map(p => {
            const isBoth = p.unitType === 'both';
            const isKgOnly = p.unitType === 'kg';
            
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
                unitSelectorHTML = `
                    <select class="unit-select" onchange="updateCartUnit(${p.id}, this.value)" ${!p.inStock ? 'disabled' : ''}>
                        <option value="יח'" ${selectedUnit === "יח'" ? 'selected' : ''}>יח'</option>
                        <option value="ק״ג" ${selectedUnit === 'ק״ג' ? 'selected' : ''}>ק״ג</option>
                    </select>
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
                <div id="card-${p.id}" class="product-card ${!p.inStock ? 'out-of-stock' : ''} ${isInCart ? 'in-cart' : ''}">
                    <div class="product-img-container">
                        ${!p.inStock ? `<div class="out-of-stock-overlay"><div class="out-of-stock-x">✕</div></div>` : ''}
                        <img src="${p.image}" alt="${p.name}" class="product-img" loading="lazy">
                    </div>
                    <div class="product-info">
                        <div>
                            <div class="product-name">${p.name}</div>
                            <div class="product-price">₪${p.price.toFixed(2)} ${unitLabel}</div>
                        </div>
                        <div class="product-actions-wrapper">
                            <div class="card-action-row">
                                <div class="quantity-control">
                                    <button type="button" class="qty-btn" onclick="changeQty(${p.id}, 1)" ${!p.inStock ? 'disabled' : ''}>+</button>
                                    <input type="number" step="${inputStep}" min="0" inputmode="${inputMode}" id="qty-${p.id}" placeholder="0" 
                                        value="${qtyVal}" oninput="updateCartItem(${p.id}, this.value)"
                                        class="product-input" ${!p.inStock ? 'disabled placeholder="לא זמין"' : ''}>
                                    <button type="button" class="qty-btn" onclick="changeQty(${p.id}, -1)" ${!p.inStock ? 'disabled' : ''}>−</button>
                                </div>
                                ${unitSelectorHTML}
                            </div>
                            ${quickButtonsHTML}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function generateQuickButtons(p) {
        let buttons = '';
        if (p.name.includes('דלעת')) {
            buttons += `<button type="button" class="quick-qty-btn" onclick="setQuickQty(${p.id}, 0.3, 'ק״ג')">300 גרם</button>`;
        }
        buttons += `
            <button type="button" class="quick-qty-btn" onclick="setQuickQty(${p.id}, 0.5, 'ק״ג')">חצי קילו</button>
            <button type="button" class="quick-qty-btn" onclick="setQuickQty(${p.id}, 1, 'ק״ג')">קילו</button>
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

        const inputField = document.getElementById(`qty-${productId}`);
        if (inputField && inputField.value !== String(finalVal)) {
            inputField.value = finalVal;
        }

        const cardElement = document.getElementById(`card-${productId}`);
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
        if (!cart[productId]) {
            cart[productId] = { qty: '', unit: newUnit };
        } else {
            cart[productId].unit = newUnit;
        }
        saveCart();
        renderProducts();
        renderCart();
    }

    // --- פונקציה חדשה: החלפת מצב משלוח / איסוף עצמי ---
    function setDeliveryMethod(method) {
        deliveryMethod = method;
        const btnDelivery = document.getElementById('btn-delivery');
        const btnPickup = document.getElementById('btn-pickup');
        const addressGroup = document.getElementById('address-group');
        const notesLabel = document.getElementById('notes-label');
        const notesInput = document.getElementById('cust-notes');
        const formTitle = document.getElementById('checkout-title');

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
        }
    }

    function renderCart() {
        const cartItemsContainer = document.getElementById('cart-items');
        const checkoutForm = document.getElementById('checkout-form');
        const cartBadge = document.getElementById('cart-badge');
        const stickyCartBar = document.getElementById('sticky-cart-bar');
        const stickyCartText = document.getElementById('sticky-cart-text');

        const validItemIds = Object.keys(cart).filter(id => cart[id].qty !== '' && Number(cart[id].qty) > 0);
        cartBadge.textContent = validItemIds.length;

        if (stickyCartBar && stickyCartText) {
            if (validItemIds.length > 0) {
                stickyCartBar.classList.add('active');
                stickyCartText.textContent = `הסל שלך (${validItemIds.length} פריטים)`;
            } else {
                stickyCartBar.classList.remove('active');
            }
        }

        if (validItemIds.length === 0) {
            cartItemsContainer.innerHTML = `<p style="color: #94a3b8; font-size: 0.875rem; text-align: center; padding: 1.5rem 0;">הסל שלך ריק כרגע.<br>בחר ירקות מהקטלוג.</p>`;
            checkoutForm.classList.add('hidden');
            return;
        }

        checkoutForm.classList.remove('hidden');

        cartItemsContainer.innerHTML = validItemIds.map(id => {
            const product = products.find(p => p.id == id);
            if(!product) return '';
            const item = cart[id];
            return `
                <div class="cart-item">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <img src="${product.image}" alt="" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                        <span style="font-weight: 500; color: #1e293b;">${product.name}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="background: #dcfce7; color: #15803d; padding: 0.125rem 0.5rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: bold;">${item.qty} ${item.unit}</span>
                        <button onclick="removeItem(${id})" class="remove-btn">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function removeItem(id) {
        delete cart[id];
        saveCart();
        renderProducts();
        renderCart();
    }

    async function sendOrder() {
        const nameInput = document.getElementById('cust-name');
        const phoneInput = document.getElementById('cust-phone');
        const addressInput = document.getElementById('cust-address');
        const notesInput = document.getElementById('cust-notes');
        
        const name = escapeHTML(nameInput.value.trim());
        const phone = escapeHTML(phoneInput.value.trim());
        const address = escapeHTML(addressInput.value.trim());
        const notes = escapeHTML(notesInput.value.trim());

        const validItemIds = Object.keys(cart).filter(id => cart[id].qty !== '' && Number(cart[id].qty) > 0);
        if (validItemIds.length === 0) { alert("העגלה שלך ריקה."); return; }

        for (const id of validItemIds) {
            const qtyNum = Number(cart[id].qty);
            if (isNaN(qtyNum) || qtyNum <= 0 || qtyNum > 999) {
                alert(`כמות לא תקינה התגלתה בעגלה. אנא תקן.`);
                return;
            }
        }

        if (name.length < 4 || !name.includes(' ')) { alert('אנא הכנס שם מלא תקין.'); nameInput.focus(); return; }
        if (!/^05\d{8}$/.test(phone.replace(/[\s-]/g, ''))) { alert('טלפון ישראלי לא תקין.'); phoneInput.focus(); return; }
        
        // --- עדכון בדיקת הכתובת: מתבצעת רק אם נבחר משלוח ---
        if (deliveryMethod === 'delivery' && address.length < 5) { 
            alert('הכנס כתובת מלאה למשלוח.'); 
            addressInput.focus(); 
            return; 
        }

        // --- עדכון הכתובת הנשלחת בהתאם לשיטת הקבלה ---
        const finalAddress = deliveryMethod === 'delivery' ? address : '🛍️ איסוף עצמי';

        let orderDetails = '';
        for (const id of validItemIds) {
            const product = products.find(p => p.id == id);
            orderDetails += `${product.name}: ${cart[id].qty} ${cart[id].unit}\n`;
        }

        const submitBtn = document.getElementById('submit-order-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'שולח הזמנה...';

        try {
            const googleScriptUrl = 'https://script.google.com/macros/s/AKfycbynKmEjuR0AyRVoXuRcEvN_4b32ggSnhlbZ9iaRtvpJcJUV8NeKizNODCyU5_9b3oHq8Q/exec';
            
            const response = await fetch(googleScriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    name: name,
                    phone: phone,
                    address: finalAddress, // שולח את הכתובת הרגילה או את המילה "איסוף עצמי"
                    notes: notes,
                    order: orderDetails
                })
            });

            if (response.ok) {
                document.getElementById('cart-content-wrapper').style.display = 'none';
                document.getElementById('success-box').classList.add('active');
                document.getElementById('cart-badge').textContent = '0';
                cart = {}; 
                saveCart();
            } else {
                alert('שגיאה בשליחת ההזמנה. נסה שוב.');
            }
        } catch (error) {
            console.error(error);
            alert('אירעה שגיאה בחיבור לשרת.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>שליחת הזמנה</span><span>✨</span>';
        }
    }

    function resetOrder() {
        cart = {};
        saveCart();
        ['cust-name', 'cust-phone', 'cust-address', 'cust-notes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('success-box').classList.remove('active');
        document.getElementById('cart-content-wrapper').style.display = 'block';
        
        // החזרת הטופס למצב הרגיל של משלוח להזמנה הבאה
        setDeliveryMethod('delivery');
        
        renderProducts();
        renderCart();
    }

    function scrollToCart() { document.getElementById('cart-section').scrollIntoView({ behavior: 'smooth' }); }
    function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

    function openKashrutModal() {
        const modal = document.getElementById('kashrut-modal');
        if (modal) { modal.classList.add('active'); document.body.style.overflow = 'hidden'; }
    }
    
    function closeKashrutModal(event) {
        if (event && event.target.closest('.modal-content') && !event.target.classList.contains('close-modal-btn')) return;
        const modal = document.getElementById('kashrut-modal');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
    }

    window.addEventListener('scroll', () => {
        const btn = document.getElementById('back-to-top-btn');
        if (btn) btn.classList.toggle('show', window.scrollY > 300);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeKashrutModal();
    });

    // חשיפת הפונקציות לעולם החיצון (הוספנו את setDeliveryMethod)
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
    window.setDeliveryMethod = setDeliveryMethod; // <-- הוסף לכאן כדי שה-HTML יוכל לקרוא לה

    loadProducts();
})();