// product.js - Módulo para la funcionalidad de la página de producto.

/**
 * Cambia la imagen principal en la galería de un producto.
 * @param {string} src - La URL de la nueva imagen a mostrar.
 */
function changeMainImage(src) {
    const mainImage = document.getElementById("mainImage");
    if (mainImage) {
        mainImage.src = src;
    }
}

/**
 * Muestra u oculta las especificaciones detalladas de un producto.
 * @param {string} productId - El identificador del producto (ej: 'basic', 'plus').
 */
function toggleSpecs(productId) {
    const shortSpecs = document.getElementById(`${productId}-specs-short`);
    const detailedSpecs = document.getElementById(`${productId}-specs-detailed`);
    const toggleText = document.getElementById(`${productId}-toggle-text`);

    if (!shortSpecs || !detailedSpecs || !toggleText) return;

    const isHidden = detailedSpecs.style.display === "none" || detailedSpecs.style.display === "";

    shortSpecs.style.display = isHidden ? "none" : "block";
    detailedSpecs.style.display = isHidden ? "block" : "none";
    toggleText.textContent = isHidden ? "Ver Menos" : "Ver Más";
}

/**
 * Abre el modal de contacto, precargando el producto si se especifica.
 * @param {string} productName - El nombre del producto a precargar.
 */
function openContactModal(productName) {
    const contactModalElem = document.getElementById("contactModal");
    if (!contactModalElem) return;

    const contactModal = new window.bootstrap.Modal(contactModalElem);
    const productField = document.querySelector("#form-container #product");

    if (productField && productName) {
        if (productName.toLowerCase().includes("básico")) productField.value = "basic";
        else if (productName.toLowerCase().includes("plus")) productField.value = "plus";
    }
    contactModal.show();
}

// product.js

// ... (tus funciones changeMainImage, toggleSpecs, openContactModal siguen igual) ...

/**
 * Simula el inicio de la compra directa y redirige para la confirmación.
 * @param {string} plan - El plan comprado ('basic' o 'plus').
 */
function handleDirectBuy(plan) {
    console.log("Iniciando compra simulada para:", plan); // Log para depuración
    
    // 1. Almacenar datos de la "compra" en localStorage
    localStorage.setItem('simulated_purchase_data', JSON.stringify({
        plan: plan,
        purchaseTime: Date.now()
    }));
    
    // 2. Redirigir a la página de "en progreso"
    window.location.href = "../pages/en-progreso.html";
}

// Exponer funciones globales
window.changeMainImage = changeMainImage;
window.toggleSpecs = toggleSpecs;
window.openContactModal = openContactModal;
window.handleDirectBuy = handleDirectBuy;

// --- AGREGADO: VINCULAR EL BOTÓN ---
document.addEventListener('DOMContentLoaded', () => {
    const buyButton = document.getElementById('directBuyButton');
    if (buyButton) {
        buyButton.addEventListener('click', (e) => {
            e.preventDefault(); // Evita que el link '#' recargue la página
            // Obtiene el plan del atributo data-plan (ej: "basic")
            const plan = buyButton.getAttribute('data-plan'); 
            handleDirectBuy(plan);
        });
    }
});