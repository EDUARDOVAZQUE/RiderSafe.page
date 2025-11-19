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

// Exponer funciones al objeto 'window' para que sean accesibles desde el HTML.
window.changeMainImage = changeMainImage;
window.toggleSpecs = toggleSpecs;
window.openContactModal = openContactModal;