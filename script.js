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
                            <input type="number" step="0.1" min="0" inputmode="decimal" id="qty-${p.id}" placeholder="כמות" 
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

    if (value.trim() === '' || Number(value) <= 0) {
        delete cart[productId];
    } else {
        cart[productId] = { qty: value, unit: unit };
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

    const validItemIds = Object.keys(cart).filter(id => cart[id].qty !== '' && Number(cart[id].qty) > 0);
    cartBadge.textContent = validItemIds.length;

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
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const address = document.getElementById('cust-address').value.trim();
    const notes = document.getElementById('cust-notes').value.trim();

    if (!name || !phone || !address) {
        alert('נא למלא את כל שדות החובה: שם, טלפון וכתובת.');
        return;
    }

    let orderDetails = '';
    for (const [id, item] of Object.entries(cart)) {
        if (!item.qty || Number(item.qty) <= 0) continue;
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
        submitBtn.textContent = 'שליחת הזמנה';
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