let products = [];
let cart = {};
let currentCategory = 'הכל';

async function loadProducts() {
    const sheetDbUrl = 'https://sheetdb.io/api/v1/nu7s9qacxtujv'; 

    try {
        const response = await fetch(sheetDbUrl);
        const data = await response.json();
        
        products = data.map(item => {
            let stockVal = String(item.inStock || '').trim().toLowerCase();
            let isAvailable = true;
            if (stockVal === 'לא' || stockVal === 'false' || stockVal === '0' || stockVal === 'no') {
                isAvailable = false;
            }

            return {
                id: Number(item.id),
                name: item.name,
                price: item.price,
                category: item.category ? item.category.trim() : 'כללי',
                unitType: item.unitType || 'both',
                image: item.image,
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
        const currentItem = cart[p.id] || { qty: '', unit: isBoth ? 'ק״ג' : 'יח\'' };
        const selectedUnit = currentItem.unit;
        const qtyVal = currentItem.qty;

        let unitSelectorHTML = '';
        if (isBoth) {
            unitSelectorHTML = `
                <select onchange="updateCartUnit(${p.id}, this.value)" ${!p.inStock ? 'disabled' : ''} style="font-size: 0.75rem; padding: 0.25rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: white; cursor: pointer;">
                    <option value="ק״ג" ${selectedUnit === 'ק״ג' ? 'selected' : ''}>ק״ג</option>
                    <option value="יח'" ${selectedUnit === "יח'" ? 'selected' : ''}>יח'</option>
                </select>
            `;
        } else {
            unitSelectorHTML = `<span style="font-size: 0.875rem; font-weight: bold; color: #64748b;">יח'</span>`;
        }

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
                        <div class="product-price">${p.price}</div>
                    </div>
                    <div style="margin-top: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                        <input type="number" step="any" id="qty-${p.id}" placeholder="כמות" 
                            value="${qtyVal}" 
                            oninput="updateCartItem(${p.id}, this.value)"
                            class="product-input" style="margin-top: 0; width: 60%;" ${inputDisabled}>
                        ${unitSelectorHTML}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateCartItem(productId, value) {
    const product = products.find(p => p.id == productId);
    if (!product || !product.inStock) return;

    const isBoth = product.unitType === 'both';
    let unit = 'יח\'';
    if (isBoth) {
        const card = document.getElementById(`qty-${productId}`).closest('.product-card');
        const selectElem = card.querySelector('select');
        if (selectElem) unit = selectElem.value;
    } else {
        unit = 'יח\'';
    }

    if (value.trim() === '' || Number(value) <= 0) {
        delete cart[productId];
    } else {
        cart[productId] = { qty: value, unit: unit };
    }
    renderCart();
}

function updateCartUnit(productId, newUnit) {
    if (cart[productId]) {
        cart[productId].unit = newUnit;
        renderCart();
    }
}

function renderCart() {
    const cartItemsContainer = document.getElementById('cart-items');
    const checkoutForm = document.getElementById('checkout-form');
    const cartBadge = document.getElementById('cart-badge');

    const itemIds = Object.keys(cart);
    cartBadge.textContent = itemIds.length;

    if (itemIds.length === 0) {
        cartItemsContainer.innerHTML = `<p style="color: #94a3b8; font-size: 0.875rem; text-align: center; padding: 1.5rem 0;">הסל שלך ריק כרגע.<br>בחר ירקות מהקטלוג.</p>`;
        checkoutForm.classList.add('hidden');
        return;
    }

    checkoutForm.classList.remove('hidden');

    cartItemsContainer.innerHTML = itemIds.map(id => {
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