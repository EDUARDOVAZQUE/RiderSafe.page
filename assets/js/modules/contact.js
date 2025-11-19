// contact.js - Módulo para el formulario de contacto con EmailJS

let emailJSInitialized = false;

/**
 * Inicializa el formulario de contacto, configura EmailJS y añade listeners.
 */
export function initContactForm() {
    if (!emailJSInitialized && window.emailjs) {
        window.emailjs.init({ publicKey: "vNkBs9jnWWeWMJrDC" });
        emailJSInitialized = true;
    }

    const contactForm = document.getElementById("contactForm");
    if (contactForm) {
        contactForm.addEventListener("submit", handleFormSubmit);

        // Listener para el crecimiento automático del textarea
        const messageTextarea = contactForm.querySelector("#message");
        if (messageTextarea) {
            messageTextarea.addEventListener('input', autoGrowTextarea);
        }
    }
}

/**
 * Valida los campos del formulario antes de enviarlo.
 * @param {HTMLFormElement} form - El formulario a validar.
 * @returns {boolean} - True si el formulario es válido, false si no.
 */
function validateForm(form) {
    const feedbackDiv = form.querySelector("#form-feedback");
    feedbackDiv.innerHTML = ""; // Limpiar errores previos

    const name = form.querySelector("#name").value.trim();
    const email = form.querySelector("#email").value.trim();
    const phone = form.querySelector("#phone").value.trim();
    const subject = form.querySelector("#subject").value.trim();
    const message = form.querySelector("#message").value.trim();

    // Verificación de campos obligatorios
    if (!name || !email || !subject || !message) {
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Por favor, completa todos los campos obligatorios (*).</div>`;
        return false;
    }

    // Verificación de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Por favor, ingresa un correo electrónico válido.</div>`;
        return false;
    }

    // Verificación de formato de teléfono (si se ingresó)
    const phoneRegex = /^[0-9\s-]{10,}$/;
    if (phone && !phoneRegex.test(phone)) {
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Por favor, ingresa un número de teléfono válido (al menos 10 dígitos).</div>`;
        return false;
    }

    return true; // Si todas las validaciones pasan
}

/**
 * Maneja la lógica de envío del formulario.
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;

    // Ejecuta la validación antes de continuar
    if (!validateForm(form)) {
        return; // Detiene el envío si el formulario no es válido
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
        if (!window.emailjs) throw new Error("La librería de EmailJS no está disponible.");

        const serviceID = "service_ww8hymc";
        const templateID = "template_r88a313";

        await window.emailjs.send(serviceID, templateID, templateParams);
        
        form.reset();
        // Restablece la altura del textarea después de enviar
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

/**
 * Hace que un textarea crezca verticalmente según su contenido.
 * @param {Event} event - El evento 'input' del textarea.
 */
function autoGrowTextarea(event) {
    const textarea = event.target;
    textarea.style.height = 'auto'; // Resetea la altura
    textarea.style.height = `${textarea.scrollHeight}px`; // Ajusta la altura al contenido
}

/**
 * Cambia el estado visual del botón de envío.
 */
function setButtonLoadingState(button, isLoading) {
    button.disabled = isLoading;
    const submitText = button.querySelector(".submit-text");
    const spinner = button.querySelector(".spinner-border");
    const loadingText = button.querySelector(".loading-text");

    if (submitText) submitText.style.display = isLoading ? "none" : "inline-block";
    if (spinner) spinner.style.display = isLoading ? "inline-block" : "none";
    if (loadingText) loadingText.style.display = isLoading ? "inline-block" : "none";
}