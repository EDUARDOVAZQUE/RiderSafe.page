// ui.js - Módulo para la manipulación de la interfaz de usuario y carga de componentes.

/**
 * Carga un componente HTML en un contenedor del DOM.
 * @param {string} url - La ruta al archivo del componente HTML.
 * @param {HTMLElement} container - El elemento del DOM donde se insertará el HTML.
 * @returns {Promise<boolean>} - True si la carga fue exitosa, false si no.
 */
export async function loadComponent(url, container) {
    if (!container) return false;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Componente no encontrado: ${url}`);
        container.innerHTML = await response.text();
        return true;
    } catch (error) {
        console.error(`[UI] Error al cargar ${url}:`, error);
        return false;
    }
}

/**
 * Carga todos los componentes comunes de la página (header, footer).
 */
export async function loadCommonComponents() {
    const components = [
        { container: document.getElementById("main-header"), path: "/components/header.html" },
        { container: document.getElementById("main-footer"), path: "/components/footer.html" },
    ];
    await Promise.all(components.map(comp => loadComponent(comp.path, comp.container)));
}

/**
 * Inicializa los listeners de eventos para el header (botones de login/logout).
 */
export function initHeaderEvents() {
    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            const authModal = document.getElementById("authModal");
            if (authModal) new window.bootstrap.Modal(authModal).show();
        });
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            const { logout } = await import("./auth.js");
            await logout();
        });
    }
}

/**
 * Resalta el enlace de navegación activo basado en la URL actual.
 */
export function markActiveNavLink() {
    const currentPagePath = window.location.pathname;
    document.querySelectorAll(".nav-link").forEach((link) => {
        const linkPath = link.getAttribute("href");
        // Comprueba si la ruta es exacta o si la página actual es una subpágina (ej. /products/basic.html y el link es /products/)
        if (linkPath && (currentPagePath === linkPath || currentPagePath.startsWith(linkPath + '/'))) {
            link.classList.add("active");
        }
    });
}