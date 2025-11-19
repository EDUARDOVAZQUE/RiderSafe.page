// main.js - Script principal que orquesta la inicialización de la aplicación RiderSafe.

// --- CAMBIO: Importamos la nueva función 'resetPassword' ---
import { initAuth, checkAuthStatus, login, register, resetPassword } from "./modules/auth.js";
import { loadComponent, loadCommonComponents, initHeaderEvents, markActiveNavLink } from "./modules/ui.js";
import { initContactForm } from "./modules/contact.js";

// =========================================================================
//  FUNCIONES GLOBALES (Expuestas para ser llamadas desde el HTML con onclick)
// =========================================================================
window.toggleSpecs = function(product) {
    const shortSpecs = document.getElementById(`${product}-specs-short`);
    const detailedSpecs = document.getElementById(`${product}-specs-detailed`);
    const toggleText = document.getElementById(`${product}-toggle-text`);
    const isHidden = detailedSpecs?.style.display === "none" || detailedSpecs?.style.display === "";

    if (shortSpecs) shortSpecs.style.display = isHidden ? "none" : "block";
    if (detailedSpecs) detailedSpecs.style.display = isHidden ? "block" : "none";
    if (toggleText) toggleText.textContent = isHidden ? "Ver Menos" : "Ver Más";
};

window.changeMainImage = function(src) {
    const mainImage = document.getElementById("mainImage");
    if (mainImage) mainImage.src = src;
};

window.openContactModal = function(productName) {
    const contactModalElem = document.getElementById("contactModal");
    if (!contactModalElem) return;
    const contactModal = new window.bootstrap.Modal(contactModalElem);
    const productField = document.querySelector("#form-container #product");

    if (productField && productName) {
        if (productName.toLowerCase().includes("básico")) productField.value = "basic";
        else if (productName.toLowerCase().includes("plus")) productField.value = "plus";
    }
    contactModal.show();
};

// =========================================================================
//  PUNTO DE ENTRADA PRINCIPAL DE LA APLICACIÓN
// =========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    initAuth(); // Inicia el listener de UI para login/logout

    const isDashboard = window.location.pathname.includes("dashboard");

    if (isDashboard) {
        // --- LÓGICA PARA LA PÁGINA DEL DASHBOARD ---
        const user = await checkAuthStatus();
        if (user) {
            await loadComponent("/components/header.html", document.getElementById("main-header"));
            initHeaderEvents();
            const { initDashboard } = await import("./modules/dashboard.js");
            initDashboard();
        } else {
            window.location.href = "/index.html";
        }
    } else {
        // --- LÓGICA PARA TODAS LAS OTRAS PÁGINAS ---
        await loadCommonComponents();
        initHeaderEvents();

        const formContainer = document.getElementById("form-container");
        if (formContainer) {
            await loadComponent("/components/form.html", formContainer);
            initContactForm();
        }

        const reviewsContainer = document.getElementById("reviews-container");
        if (reviewsContainer) {
            await loadComponent("/components/reviews.html", reviewsContainer);
            const { initReviewSystem } = await import("./reviews.js");
            initReviewSystem();
        }

        const authContainer = document.getElementById("auth-container");
        if (authContainer) {
            // Carga el HTML del modal
            await loadComponent("/components/auth.html", authContainer);
            // Llama a la función actualizada que está al final de este archivo
            initAuthModal(); 
        }
    }
    const heroCarousel = document.getElementById('heroCarousel');
    if (heroCarousel) {
        const progressBar = heroCarousel.querySelector('.carousel-progress-bar');

        const resetAnimation = () => {
            const interval = heroCarousel.getAttribute('data-bs-interval') || 5000; 
            progressBar.style.animationDuration = `${interval}ms`; 

            progressBar.classList.remove('animate');
            void progressBar.offsetWidth; 
            progressBar.classList.add('animate');
        };

        resetAnimation();
        heroCarousel.addEventListener('slide.bs.carousel', resetAnimation);
    }

    setupNavbarScrollEffect();
    markActiveNavLink(); 
});

// =========================================================================
//  FUNCIONES AUXILIARES
// =========================================================================

function setupNavbarScrollEffect() {
    window.addEventListener("scroll", () => {
        const navbar = document.querySelector(".navbar");
        if (navbar) {
            navbar.classList.toggle('scrolled', window.scrollY > 50);
        }
    });
}

// --- CAMBIO: Toda esta sección ha sido reemplazada ---

/**
 * Inicializa toda la lógica del modal de autenticación
 * (formularios, enlaces para cambiar paneles, reseteo del modal).
 */
function initAuthModal() {
    // Selectores de Elementos
    const authModal = document.getElementById('authModal');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    
    const showResetPanelLink = document.getElementById('showResetPanelLink');
    const showLoginPanelLink = document.getElementById('showLoginPanelLink');
    
    const authTabs = document.getElementById('authTabs');
    const loginTabButton = document.getElementById('login-tab-button');

    // Lógica para cambiar entre paneles (Login <-> Reset)
    if (showResetPanelLink) {
        showResetPanelLink.addEventListener('click', (e) => {
            e.preventDefault();
            authTabs.style.display = 'none';
            document.getElementById('login-panel').classList.remove('show', 'active');
            document.getElementById('reset-panel').classList.add('show', 'active');
        });
    }

    if (showLoginPanelLink) {
        showLoginPanelLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('reset-panel').classList.remove('show', 'active');
            authTabs.style.display = 'flex';
            document.getElementById('login-panel').classList.add('show', 'active');
        });
    }

    // Reseteo del Modal al abrirse
    if (authModal) {
        authModal.addEventListener('show.bs.modal', () => {
            // Vuelve a mostrar las pestañas y oculta el panel de reseteo
            authTabs.style.display = 'flex';
            document.getElementById('reset-panel').classList.remove('show', 'active');

            // Activa la pestaña de login por defecto
            document.getElementById('login-panel').classList.add('show', 'active');
            document.getElementById('register-panel').classList.remove('show', 'active');
            if (loginTabButton) {
                loginTabButton.classList.add('active');
                const registerTabButton = document.querySelector('[data-bs-target="#register-panel"]');
                if (registerTabButton) {
                    registerTabButton.classList.remove('active');
                }
            }

            // Limpia todos los formularios y mensajes de error/éxito
            [loginForm, registerForm, resetPasswordForm].forEach(form => {
                if (form) {
                    form.reset();
                    clearAuthMessages(form);
                }
            });
        });
    }

    // Listener del Formulario de Login
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearAuthMessages(loginForm);
            const email = loginForm.email.value;
            const password = loginForm.password.value;
            
            // Llama a la función 'login' importada
            const result = await login(email, password); 
            if (!result.success) {
                showAuthError(loginForm, result.error);
            }
            // Si tiene éxito, 'login' en auth.js cierra el modal
        });
    }

    // Listener del Formulario de Registro
    if (registerForm) {
        registerForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearAuthMessages(registerForm);
            
            const fullName = registerForm.fullName.value;
            const email = registerForm.email.value;
            const password = registerForm.password.value;
            const confirmPassword = registerForm.confirmPassword.value;

            if (password !== confirmPassword) {
                showAuthError(registerForm, "Las contraseñas no coinciden");
                return;
            }
            
            // Llama a la función 'register' importada
            const result = await register(fullName, email, password); 
            
            if (result.success) {
                registerForm.reset();
                // Muestra el mensaje de "Verifica tu correo"
                showAuthSuccess(registerForm, result.message); 
            } else {
                showAuthError(registerForm, result.error);
            }
        });
    }
    
    // Listener del Formulario de Reestablecer Contraseña
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAuthMessages(resetPasswordForm);

            const email = resetPasswordForm.email.value;
            // Llama a la nueva función 'resetPassword' importada
            const result = await resetPassword(email); 

            if (result.success) {
                resetPasswordForm.reset();
                showAuthSuccess(resetPasswordForm, result.message);
            } else {
                showAuthError(resetPasswordForm, result.error);
            }
        });
    }
}

// --- CAMBIO: Nuevas funciones helper para mensajes ---

/**
 * Muestra un mensaje de error en un formulario.
 * @param {HTMLElement} form El formulario donde mostrar el error.
 * @param {string} message El mensaje de error.
 */
function showAuthError(form, message) {
    const errorDiv = form.querySelector('.form-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

/**
 * Muestra un mensaje de éxito en un formulario.
 * @param {HTMLElement} form El formulario donde mostrar el mensaje.
 * @param {string} message El mensaje de éxito.
 */
function showAuthSuccess(form, message) {
    const successDiv = form.querySelector('.form-success');
    if (successDiv) {
        successDiv.textContent = message;
        successDiv.style.display = 'block';
    }
}

/**
 * Limpia los mensajes de error y éxito de un formulario.
 * @param {HTMLElement} form El formulario a limpiar.
 */
function clearAuthMessages(form) {
    if(form) {
        const errorDiv = form.querySelector('.form-error');
        const successDiv = form.querySelector('.form-success');
        if (errorDiv) {
            errorDiv.textContent = '';
            errorDiv.style.display = 'none';
        }
        if (successDiv) {
            successDiv.textContent = '';
            successDiv.style.display = 'none';
        }
    }
}