// auth.js - Módulo para la autenticación y gestión de usuarios con Firebase.

import { auth, db } from "../config/firebase-config.js";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendEmailVerification,     // <-- AÑADIDO
    sendPasswordResetEmail,    // <-- AÑADIDO
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, setDoc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

let currentUser = null;

/**
 * Inicializa el listener de estado de autenticación de Firebase.
 * Mantiene la UI sincronizada con el estado de login del usuario.
 */
export function initAuth() {
    onAuthStateChanged(auth, (user) => {
        // Solo actualiza currentUser si está verificado o es null
        if (user && user.emailVerified) {
            currentUser = user;
        } else if (!user) {
            currentUser = null;
        }
        // Actualiza la UI basado en si hay un usuario verificado
        updateAuthUI(currentUser);
    });
}

/**
 * Actualiza la UI global (botones, enlaces, PAYPAL) según el estado de autenticación.
 * @param {object|null} user - El objeto de usuario de Firebase o null.
 */
function updateAuthUI(user) {
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const dashboardLink = document.getElementById("dashboardLink");
    
    // --- NUEVO: Elementos de PayPal ---
    const paypalForm = document.getElementById('paypal-form');
    const loginWarning = document.getElementById('login-warning');

    const isLoggedIn = !!user; // Convierte user a un booleano (true si logueado, false si no)

    // Lógica existente de menú
    if (loginBtn) loginBtn.style.display = isLoggedIn ? "none" : "block";
    if (logoutBtn) logoutBtn.style.display = isLoggedIn ? "block" : "none";
    if (dashboardLink) dashboardLink.style.display = isLoggedIn ? "block" : "none";

    // --- NUEVO: Lógica del botón de PayPal ---
    // Verificamos si existe el formulario en esta página para evitar errores en otras páginas
    if (paypalForm) {
        paypalForm.style.display = isLoggedIn ? "block" : "none";
    }

    if (loginWarning) {
        loginWarning.style.display = isLoggedIn ? "none" : "block";
    }
}

/**
 * Inicia sesión de un usuario y verifica si su correo está validado.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
export async function login(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // --- MEJORA: Verificación de Email ---
        if (!user.emailVerified) {
            await signOut(auth); // Desloguear al usuario
            return {
                success: false,
                error: "Tu cuenta aún no ha sido verificada. Por favor, revisa tu correo."
            };
        }
        // --- FIN DE MEJORA ---

        closeAuthModal();
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error("[Auth] Error en login:", error.code);
        return { success: false, error: getAuthErrorMessage(error) };
    }
}

/**
 * Registra un nuevo usuario, crea su perfil y envía un correo de verificación.
 * @param {string} fullName
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function register(fullName, email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // --- MEJORA: Enviar correo de verificación ---
        await sendEmailVerification(user);
        // --- FIN DE MEJORA ---

        // Crear documento en Firestore
        await setDoc(doc(db, "usuarios", user.uid), {
            fullName: fullName,
            email: user.email,
            createdAt: new Date().toISOString(),
            purchasedProducts: [],
            activationCodes: [],
            vehicles: [],
        });

        // --- MEJORA: Desloguear para forzar verificación ---
        await signOut(auth);

        // No cerrar el modal, sino mostrar mensaje de éxito
        return {
            success: true,
            message: "¡Registro exitoso! Revisa tu correo electrónico para verificar tu cuenta."
        };

    } catch (error) {
        console.error("[Auth] Error en registro:", error.code);
        return { success: false, error: getAuthErrorMessage(error) };
    }
}

/**
 * NUEVA FUNCIÓN: Envía un correo para reestablecer la contraseña.
 * @param {string} email
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        return {
            success: true,
            message: "Enlace de reestablecimiento enviado. Revisa tu correo."
        };
    } catch (error) {
        console.error("[Auth] Error en reset password:", error.code);
        return {
            success: false,
            error: getAuthErrorMessage(error)
        };
    }
}


/**
 * Cierra la sesión del usuario actual.
 */
export async function logout() {
    try {
        await signOut(auth);
        if (window.location.pathname.includes("dashboard")) {
            window.location.href = "../index.html";
        }
    } catch (error) {
        console.error("[Auth] Error en logout:", error);
    }
}

/**
 * Devuelve el objeto del usuario actualmente autenticado.
 * @returns {object|null}
 */
export function getCurrentUser() {
    return currentUser;
}

/**
 * Obtiene los datos de un usuario desde Firestore.
 * @param {string} uid - El ID del usuario.
 * @returns {Promise<object|null>}
 */
export async function getUserData(uid) {
    if (!uid) return null;
    try {
        const userDoc = await getDoc(doc(db, "usuarios", uid));
        return userDoc.exists() ? userDoc.data() : null;
    } catch (error) {
        console.error("[Auth] Error obteniendo datos del usuario:", error);
        return null;
    }
}



/**
 * Devuelve una promesa que se resuelve con el estado de autenticación inicial.
 * Resuelve null si el usuario no está verificado.
 * @returns {Promise<object|null>}
 */
export const checkAuthStatus = () => {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            // Resolver solo si el usuario existe Y está verificado
            if (user && user.emailVerified) {
                resolve(user);
            } else {
                resolve(null);
            }
        });
    });
};


// --- Funciones Auxiliares ---

/**
 * Cierra el modal de autenticación si está abierto.
 */
function closeAuthModal() {
    const authModal = document.getElementById("authModal");
    if (authModal && window.bootstrap) {
        const modal = window.bootstrap.Modal.getInstance(authModal);
        if (modal) modal.hide();
    }
}

/**
 * Traduce los códigos de error de Firebase a mensajes amigables.
 * @param {object} error - El objeto de error de Firebase.
 * @returns {string} - El mensaje de error para el usuario.
 */
function getAuthErrorMessage(error) {
    switch (error.code) {
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
            return "Correo electrónico o contraseña incorrectos.";
        case "auth/invalid-email":
            return "El formato del correo electrónico no es válido.";
        case "auth/email-already-in-use":
            return "Este correo electrónico ya está registrado.";
        case "auth/weak-password":
            return "La contraseña debe tener al menos 6 caracteres.";
        case "auth/too-many-requests":
            return "Demasiados intentos fallidos. Inténtalo de nuevo más tarde.";
        default:
            return "Ocurrió un error inesperado. Por favor, intenta de nuevo.";
    }
}
// --- FUNCIONES PARA LICENCIAS (Agrega esto al final de auth.js) ---

/**
 * Genera un código de licencia alfanumérico largo.
 * @param {number} length 
 * @returns {string}
 */
function generateLicenseCode(length = 16) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code.match(/.{1,4}/g).join('-');
}

/**
 * Registra una nueva licencia en Firestore.
 * IMPRESCINDIBLE: Debe tener la palabra 'export' para usarse en otros archivos.
 */
export async function registerNewLicense(purchaseId, userId, plan) {
    let success = false;
    let attempts = 0;
    let newCode = '';
    const MAX_ATTEMPTS = 5;

    while (!success && attempts < MAX_ATTEMPTS) {
        attempts++;
        newCode = generateLicenseCode(16);
        const licenseRef = doc(db, "licencias", newCode);

        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(licenseRef);
                if (docSnap.exists()) {
                    throw new Error("Code collision");
                }
                transaction.set(licenseRef, {
                    purchaseId: purchaseId,
                    userId: userId,
                    plan: plan,
                    active: false,
                    activationCode: newCode,
                    generatedOn: new Date().toISOString(),
                });
            });
            success = true;
            console.log(`Licencia ${newCode} generada.`);
        } catch (error) {
            if (error.message !== "Code collision") {
                console.error("Error crítico:", error);
                return { success: false, error: error.message };
            }
        }
    }
    
    return success ? { success: true, code: newCode } : { success: false, error: "Error al generar código único." };
}

/**
 * Activa un código de producto de forma segura (ATÓMICA).
 * Requiere que el documento de licencia con ID = `code` ya exista y tenga active: false.
 * @param {string} code - El código de activación (ID del documento).
 * @returns {Promise<{success: boolean, error?: string, plan?: string}>}
 */
export async function activateProductCode(code) {
    const user = getCurrentUser(); // Asegúrate de que esta función existe en este archivo
    if (!user) {
        return { success: false, error: "Debes iniciar sesión para activar un código." };
    }

    const licenseRef = doc(db, "licencias", code);
    const userRef = doc(db, "usuarios", user.uid);

    try {
        let planUsed = null;
        const newVehicleId = `vehicle_${user.uid}_${Date.now()}`;

        await runTransaction(db, async (transaction) => {
            const licenseDoc = await transaction.get(licenseRef);
            const userDoc = await transaction.get(userRef);

            // Validaciones
            if (!licenseDoc.exists()) {
                throw new Error("Código de activación inválido o no encontrado.");
            }

            const licenseData = licenseDoc.data();
            
            if (licenseData.active === true) {
                throw new Error("Este código ya ha sido activado y consumido.");
            }

            if (licenseData.userId && licenseData.userId !== user.uid) {
                throw new Error("El código está asignado a otro usuario.");
            }

            // Preparar datos
            planUsed = licenseData.plan || (code.toUpperCase().includes("PLUS") ? "plus" : "basic");
            const userData = userDoc.data() || {};

            // Escrituras Atómicas
            transaction.update(licenseRef, {
                active: true,
                activatedAt: new Date().toISOString(),
                vehicleId: newVehicleId,
                userId: user.uid,
                plan: planUsed,
            });

            transaction.set(doc(db, "dispositivos", newVehicleId), {
                userId: user.uid,
                licenseId: code,
                bateria: 85,
                inclinacion: 0,
                velocidad: 0,
                ubicacion: { latitude: 20.138, longitude: -99.2015 },
                timestamp: new Date().toISOString(),
            });

            transaction.update(userRef, {
                vehicles: [...(userData.vehicles || []), newVehicleId],
                activationCodes: [...(userData.activationCodes || []), code],
                purchasedProducts: [...(userData.purchasedProducts || []), `ridersafe-${planUsed}`],
            });
        });

        return { success: true, plan: planUsed };

    } catch (error) {
        console.error("[Auth] Error en activación:", error.message);
        return { success: false, error: error.message || "Error al activar." };
    }
}