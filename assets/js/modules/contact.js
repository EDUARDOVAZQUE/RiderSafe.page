// assets/js/modules/contact.js

// ==========================================
//  1. CONFIGURACIÓN CENTRALIZADA
// ==========================================
// Asegúrate de que NO haya espacios en blanco al inicio o final de este string
const EMAILJS_PUBLIC_KEY = "vNkBs9jnWWeWMJrDC"; 
const SERVICE_ID = "service_ww8hymc";

// Template para el Formulario de Contacto
const CONTACT_TEMPLATE_ID = "template_r88a313";

// Template para el Envío de Licencia
// RECUERDA: Verifica que este ID sea el de tu nuevo template de licencia
const LICENSE_TEMPLATE_ID = "template_ju00jko"; 

let emailJSInitialized = false;

/**
 * Inicializa EmailJS.
 * CORRECCIÓN: Pasamos la key directamente como string para mayor compatibilidad con CDN v3.
 */
function ensureEmailJSInitialized() {
    if (!emailJSInitialized && window.emailjs) {
        // Corrección: Pasamos el string directo en lugar de objeto para evitar errores en v3
        window.emailjs.init(EMAILJS_PUBLIC_KEY);
        emailJSInitialized = true;
        console.log("[EmailJS] Inicializado correctamente.");
    }
}

// ==========================================
//  2. FUNCIÓN PARA EL DASHBOARD / COMPRA
// ==========================================

export async function sendLicenseEmail(email, name, code, plan) {
    ensureEmailJSInitialized();

    const templateParams = {
        to_email: email,
        to_name: name,
        license_code: code,
        plan_name: plan
    };

    try {
        // CORRECCIÓN CRÍTICA: Pasamos EMAILJS_PUBLIC_KEY como 4to argumento.
        // Esto garantiza que la key se envíe incluso si el init() falló.
        await window.emailjs.send(SERVICE_ID, LICENSE_TEMPLATE_ID, templateParams, EMAILJS_PUBLIC_KEY);
        console.log(`[Email] Licencia enviada a ${email}`);
        return true;
    } catch (error) {
        console.error("[Email] Error enviando licencia:", error);
        return false;
    }
}

// ==========================================
//  3. FUNCIONES PARA EL FORMULARIO DE CONTACTO
// ==========================================

export function initContactForm() {
    ensureEmailJSInitialized();

    const contactForm = document.getElementById("contactForm");
    if (contactForm) {
        contactForm.removeEventListener("submit", handleFormSubmit);
        contactForm.addEventListener("submit", handleFormSubmit);

        const messageTextarea = contactForm.querySelector("#message");
        if (messageTextarea) {
            messageTextarea.addEventListener('input', autoGrowTextarea);
        }
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;

    if (!validateForm(form)) {
        return; 
    }
    
    const feedbackDiv = form.querySelector("#form-feedback");
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const templateParams = {
        subject: form.querySelector("#subject option:checked").textContent,
        name: form.querySelector("#name").value,
        email: form.querySelector("#email").value,
        phone: form.querySelector("#phone").value,
        message: form.querySelector("#message").value,
        time: new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" }),
    };

    setButtonLoadingState(submitBtn, true);

    try {
        // CORRECCIÓN CRÍTICA: Aquí también pasamos la Public Key explícitamente
        await window.emailjs.send(SERVICE_ID, CONTACT_TEMPLATE_ID, templateParams, EMAILJS_PUBLIC_KEY);
        
        form.reset();
        const messageTextarea = form.querySelector("#message");
        if(messageTextarea) messageTextarea.style.height = 'auto';

        feedbackDiv.innerHTML = `<div class="alert alert-success">¡Mensaje enviado con éxito!</div>`;

    } catch (error) {
        console.error("[Contact] Error de EmailJS:", error);
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Hubo un error al enviar el mensaje.</div>`;
    } finally {
        setButtonLoadingState(submitBtn, false);
    }
}

// ==========================================
//  4. FUNCIONES AUXILIARES
// ==========================================

function validateForm(form) {
    const feedbackDiv = form.querySelector("#form-feedback");
    feedbackDiv.innerHTML = "";

    const name = form.querySelector("#name").value.trim();
    const email = form.querySelector("#email").value.trim();
    const phone = form.querySelector("#phone").value.trim();
    const subject = form.querySelector("#subject").value.trim();
    const message = form.querySelector("#message").value.trim();

    if (!name || !email || !subject || !message) {
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Por favor, completa todos los campos obligatorios (*).</div>`;
        return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Por favor, ingresa un correo electrónico válido.</div>`;
        return false;
    }

    const phoneRegex = /^[0-9\s-]{10,}$/;
    if (phone && !phoneRegex.test(phone)) {
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Por favor, ingresa un número de teléfono válido (al menos 10 dígitos).</div>`;
        return false;
    }

    return true;
}

function autoGrowTextarea(event) {
    const textarea = event.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function setButtonLoadingState(button, isLoading) {
    button.disabled = isLoading;
    const submitText = button.querySelector(".submit-text");
    const spinner = button.querySelector(".spinner-border");
    const loadingText = button.querySelector(".loading-text");

    if (submitText) submitText.style.display = isLoading ? "none" : "inline-block";
    if (spinner) spinner.style.display = isLoading ? "inline-block" : "none";
    if (loadingText) loadingText.style.display = isLoading ? "inline-block" : "none";
}