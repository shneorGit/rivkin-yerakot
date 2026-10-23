let products = [];
let cart = {};
let currentCategory = 'הכל';

async function loadProducts() {
    const sheetDbUrl = 'https://sheetdb.io/api/v1/nu7s9qacxtujv'; 

    try {
        const response = await fetch(sheetDbUrl);
        const data = await response.json();
        
        products = data.map(item => {
            let stockVal = String(item['במלאי'] || '').trim().toLowerCase();
            let isAvailable = true;
            if (stockVal === 'לא' || stockVal === 'false' || stockVal === '0' || stockVal === 'no') {
                isAvailable = false;
            }

            // המרה של סוג היחידה מהעברית בגיליון לקוד מאחורי הקלעים
            let rawUnit = String(item['סוג יחידה'] || '').trim();
            let mappedUnit = 'both'; // ברירת מחדל
            if (rawUnit === 'יחידות בלבד') {
                mappedUnit = 'unit';
            } else if (rawUnit === 'ק"ג ויחידות') {
                mappedUnit = 'both';
            } else if (rawUnit === 'ק"ג בלבד') {
                mappedUnit = 'kg';
            }

            let rawPrice = String(item['מחיר'] || '').replace(/[₪,]/g, '').trim();
            let numericPrice = parseFloat(rawPrice) || 0;

            return {
                id: Number(item['מזהה']),
                name: item['שם'],
                price: numericPrice,
                category: item['קטגוריה'] ? item['קטגוריה'].trim() : 'כללי',
                unitType: mappedUnit,
                image: item['תמונה'],
                inStock: isAvailable
            };
        });

        // סינון: הסרה מוחלטת של מוצרים שאינם במלאי מהקטלוג
        products = products.filter(p => p.inStock);

        renderCategories();
        renderProducts();
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

function renderProducts() {
    const grid = document.getElementById('products-grid');
    
    const filteredProducts = currentCategory === 'הכל' 
        ? products 
        : products.filter(p => p.category === currentCategory);

    if (filteredProducts.length === 0) {
        grid.innerHTML = '<p style="grid-column: span 2; text-align: center; padding: 2rem; color: #64748b;">אין מוצרים בקטגוריה זו כרגע.</p>';
        return;
    }

    grid.innerHTML = filteredProducts.map(p => {
        const isBoth = p.unitType === 'both';
        const isKgOnly = p.unitType === 'kg';
        
        // ברירת מחדל: אם זה 'both' מתחילים ב־'יח'', אם זה 'kg' מתחילים ב־'ק״ג'
        const currentItem = cart[p.id] || { qty: '', unit: isKgOnly ? 'ק״ג' : 'יח\'' };
        const selectedUnit = currentItem.unit;
        const qtyVal = currentItem.qty;

        // הגדרת האם מותר עשרוני (רק אם זה ק"ג או אם נבחר ק"ג במוצר משולב)
        const isDecimalAllowed = isKgOnly || (isBoth && selectedUnit === 'ק״ג');
        const inputStep = isDecimalAllowed ? "0.1" : "1";
        const inputMode = isDecimalAllowed ? "decimal" : "numeric";

        let unitSelectorHTML = '';
        let quickButtonsHTML = '';

        if (isKgOnly) {
            // ק"ג בלבד: מציג קבוע ק״ג ומציג מיד את כפתורי הקיצור בלי לחכות לבחירה
            unitSelectorHTML = `<span style="font-size: 0.875rem; font-weight: bold; color: #64748b;">ק״ג</span>`;
            
            let buttons = '';
            if (p.name.includes('דלעת')) {
                buttons += `<button type="button" onclick="setQuickQty(${p.id}, 0.3, 'ק״ג')" style="font-size: 0.7rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; cursor: pointer; color: #334155;">300 גרם</button>`;
            }
            buttons += `
                <button type="button" onclick="setQuickQty(${p.id}, 0.5, 'ק״ג')" style="font-size: 0.7rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; cursor: pointer; color: #334155;">חצי קילו</button>
                <button type="button" onclick="setQuickQty(${p.id}, 1, 'ק״ג')" style="font-size: 0.7rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; cursor: pointer; color: #334155;">קילו</button>
            `;
            quickButtonsHTML = `<div style="display: flex; gap: 0.25rem; margin-top: 0.5rem; flex-wrap: wrap;">${buttons}</div>`;

        } else if (isBoth) {
            // גם וגם: מתחיל ב־יח' ומאפשר לבחור, כפתורים מופיעים רק אם בחרו ק״ג
            unitSelectorHTML = `
                <select onchange="updateCartUnit(${p.id}, this.value)" ${!p.inStock ? 'disabled' : ''} style="font-size: 0.75rem; padding: 0.25rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: white; cursor: pointer;">
                    <option value="יח'" ${selectedUnit === "יח'" ? 'selected' : ''}>יח'</option>
                    <option value="ק״ג" ${selectedUnit === 'ק״ג' ? 'selected' : ''}>ק״ג</option>
                </select>
            `;

            if (selectedUnit === 'ק״ג') {
                let buttons = '';
                if (p.name.includes('דלעת')) {
                    buttons += `<button type="button" onclick="setQuickQty(${p.id}, 0.3, 'ק״ג')" style="font-size: 0.7rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; cursor: pointer; color: #334155;">300 גרם</button>`;
                }
                buttons += `
                    <button type="button" onclick="setQuickQty(${p.id}, 0.5, 'ק״ג')" style="font-size: 0.7rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; cursor: pointer; color: #334155;">חצי קילו</button>
                    <button type="button" onclick="setQuickQty(${p.id}, 1, 'ק״ג')" style="font-size: 0.7rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; cursor: pointer; color: #334155;">קילו</button>
                `;
                quickButtonsHTML = `<div style="display: flex; gap: 0.25rem; margin-top: 0.5rem; flex-wrap: wrap;">${buttons}</div>`;
            }
        } else {
            // יחידות בלבד
            unitSelectorHTML = `<span style="font-size: 0.875rem; font-weight: bold; color: #64748b;">יח'</span>`;
        }

        const unitLabel = (isBoth || isKgOnly) ? 'לק״ג' : 'ליחידה';
        const formattedPrice = `₪${p.price.toFixed(2)} ${unitLabel}`;

        const cardClass = p.inStock ? 'product-card' : 'product-card out-of-stock';
        const overlayHTML = p.inStock ? '' : `
            <div class="out-of-stock-overlay">
                <div class="out-of-stock-x">✕</div>
            </div>
        `;
        const inputDisabled = p.inStock ? '' : 'disabled placeholder="לא זמין"';

        return `
            <div class="${cardClass}">
                <div class="product-img-container">
                    ${overlayHTML}
                    <img src="${p.image}" alt="${p.name}" class="product-img" loading="lazy">
                </div>
                <div class="product-info">
                    <div>
                        <div class="product-name">${p.name}</div>
                        <div class="product-price">${formattedPrice}</div>
                    </div>
                    <div style="margin-top: 1rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                            <input type="number" step="${inputStep}" min="${isDecimalAllowed ? '0.1' : '1'}" inputmode="${inputMode}" id="qty-${p.id}" placeholder="כמות" 
                                value="${qtyVal}" 
                                oninput="updateCartItem(${p.id}, this.value)"
                                class="product-input" style="margin-top: 0; width: 60%;" ${inputDisabled}>
                            ${unitSelectorHTML}
                        </div>
                        ${quickButtonsHTML}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function setQuickQty(productId, qty, unit) {
    const product = products.find(p => p.id == productId);
    if (!product || !product.inStock) return;

    const inputField = document.getElementById(`qty-${productId}`);
    if (inputField) {
        inputField.value = qty;
    }

    cart[productId] = { qty: qty, unit: unit };
    renderCart();
}

function updateCartItem(productId, value) {
    const product = products.find(p => p.id == productId);
    if (!product || !product.inStock) return;

    const isBoth = product.unitType === 'both';
    const isKgOnly = product.unitType === 'kg';
    
    let unit = 'יח\'';
    if (isKgOnly) {
        unit = 'ק״ג';
    } else if (isBoth) {
        const card = document.getElementById(`qty-${productId}`).closest('.product-card');
        const selectElem = card.querySelector('select');
        if (selectElem) unit = selectElem.value;
    }

    // אם זה יחידות (לא ק"ג ולא נבחר ק"ג), נדאג שאין מספר עשרוני
    let finalVal = value;
    const isDecimalAllowed = isKgOnly || (isBoth && unit === 'ק״ג');
    
    if (!isDecimalAllowed && value.includes('.')) {
        finalVal = Math.floor(Number(value)); // מעגל למספר שלם
        const inputField = document.getElementById(`qty-${productId}`);
        if (inputField) inputField.value = finalVal; // מעדכן חזרה בשדה
    }

    if (String(finalVal).trim() === '' || Number(finalVal) <= 0) {
        delete cart[productId];
    } else {
        cart[productId] = { qty: finalVal, unit: unit };
    }
    renderCart();
}

function updateCartUnit(productId, newUnit) {
    if (cart[productId] && cart[productId].qty !== '' && Number(cart[productId].qty) > 0) {
        cart[productId].unit = newUnit;
        renderCart();
    } else {
        if (!cart[productId]) {
            cart[productId] = { qty: '', unit: newUnit };
        } else {
            cart[productId].unit = newUnit;
        }
        renderProducts();
        renderCart();
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

    // עדכון הבר הצף במובייל
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
        const item = cart[id];
        const displayText = `${item.qty} ${item.unit}`;
        return `
            <div class="cart-item">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <img src="${product.image}" alt="" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                    <span style="font-weight: 500; color: #1e293b;">${product.name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="background: #dcfce7; color: #15803d; padding: 0.125rem 0.5rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: bold;">${displayText}</span>
                    <button onclick="removeItem(${id})" class="remove-btn">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

function removeItem(id) {
    delete cart[id];
    const inputField = document.getElementById(`qty-${id}`);
    if (inputField) inputField.value = '';
    renderProducts();
    renderCart();
}

function scrollToCart() {
    document.getElementById('cart-section').scrollIntoView({ behavior: 'smooth' });
}

async function sendOrder() {
    const nameInput = document.getElementById('cust-name');
    const phoneInput = document.getElementById('cust-phone');
    const addressInput = document.getElementById('cust-address');
    const notesInput = document.getElementById('cust-notes');

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const address = addressInput.value.trim();
    const notes = notesInput.value.trim();

    // 1. בדיקה שיש פריטים בעגלה
    const validItemIds = Object.keys(cart).filter(id => cart[id].qty !== '' && Number(cart[id].qty) > 0);
    if (validItemIds.length === 0) {
        alert("העגלה שלך ריקה. בחר מוצרים לפני שליחת ההזמנה.");
        return;
    }

    // 2. בדיקת כמויות תקינות לכל פריט בעגלה
    for (const id of validItemIds) {
        const item = cart[id];
        const qtyNum = Number(item.qty);
        const product = products.find(p => p.id == id);
        const productName = product ? product.name : 'מוצר';

        if (isNaN(qtyNum) || qtyNum <= 0) {
            alert(`הכמות עבור "${productName}" אינה תקינה.`);
            return;
        }
        if (qtyNum > 999) {
            alert(`הכמות עבור "${productName}" חורגת מהמקסימום המותר (999). אנא תקן את הכמות.`);
            return;
        }
    }

    // 3. בדיקת שם מלא (דורש לפחות 4 תווים ורווח בין שם פרטי למשפחה)
    if (name.length < 4 || !name.includes(' ')) {
        alert('אנא הכנס שם מלא תקין (שם פרטי ומשפחה).');
        nameInput.focus();
        return;
    }

    // 4. בדיקת טלפון נייד ישראלי בסיסי (05XXXXXXXX)
    const cleanPhone = phone.replace(/[\s-]/g, '');
    const phoneRegex = /^05\d{8}$/;
    if (!phoneRegex.test(cleanPhone)) {
        alert('אנא הכנס מספר טלפון נייד ישראלי תקין (לדוגמה: 0501234567).');
        phoneInput.focus();
        return;
    }

    // 5. בדיקת כתובת (לפחות 5 תווים)
    if (address.length < 5) {
        alert('אנא הכנס כתובת למשלוח הכוללת רחוב ומספר בית.');
        addressInput.focus();
        return;
    }

    let orderDetails = '';
    for (const id of validItemIds) {
        const item = cart[id];
        const product = products.find(p => p.id == id);
        orderDetails += `${product.name}: ${item.qty} ${item.unit}\n`;
    }

    const formspreeUrl = 'https://formspree.io/f/xzedqoop'; 

    const submitBtn = document.getElementById('submit-order-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'שולח הזמנה...';

    try {
        const response = await fetch(formspreeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                phone: phone,
                address: address,
                notes: notes,
                order: orderDetails
            })
        });

        if (response.ok) {
            document.getElementById('cart-content-wrapper').style.display = 'none';
            document.getElementById('success-box').classList.add('active');
            document.getElementById('cart-badge').textContent = '0';
        } else {
            alert('שגיאה בשליחת ההזמנה. נסה שוב.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('אירעה שגיאה בחיבור לשרת.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>שליחת הזמנה</span><span>✨</span>';
    }
}

function resetOrder() {
    cart = {};
    document.getElementById('cust-name').value = '';
    document.getElementById('cust-phone').value = '';
    document.getElementById('cust-address').value = '';
    document.getElementById('cust-notes').value = '';
    
    document.getElementById('success-box').classList.remove('active');
    document.getElementById('cart-content-wrapper').style.display = 'block';
    
    loadProducts();
    renderCart();
}

loadProducts();