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
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

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
 * Actualiza la UI global (botones, enlaces) según el estado de autenticación.
 * @param {object|null} user - El objeto de usuario de Firebase o null.
 */
function updateAuthUI(user) {
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const dashboardLink = document.getElementById("dashboardLink");

    const isLoggedIn = !!user; // Convierte user a un booleano

    if (loginBtn) loginBtn.style.display = isLoggedIn ? "none" : "block";
    if (logoutBtn) logoutBtn.style.display = isLoggedIn ? "block" : "none";
    if (dashboardLink) dashboardLink.style.display = isLoggedIn ? "block" : "none";
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
            window.location.href = "/index.html";
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
 * Activa un código de producto, creando la licencia y el dispositivo asociado.
 * @param {string} code - El código de activación.
 * @returns {Promise<{success: boolean, error?: string, plan?: string}>}
 */
export async function activateProductCode(code) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: "Debes iniciar sesión para activar un código." };
    }

    try {
        const userData = await getUserData(user.uid);
        if (userData.activationCodes?.includes(code)) {
            return { success: false, error: "Este código ya ha sido utilizado." };
        }

        const plan = code.toUpperCase().includes("PLUS") ? "plus" : "basic";
        const vehicleId = `vehicle_${user.uid}_${Date.now()}`;
        const licenseId = `license_${user.uid}_${Date.now()}`;

        // Crear la licencia
        await setDoc(doc(db, "licencias", licenseId), {
            plan,
            vehicleId,
            userId: user.uid,
            activationCode: code,
            activatedAt: new Date().toISOString(),
            active: true,
        });

        // Crear el dispositivo con datos iniciales
        await setDoc(doc(db, "dispositivos", vehicleId), {
            userId: user.uid,
            licenseId,
            bateria: 85,
            inclinacion: 0,
            velocidad: 0,
            ubicacion: { latitude: 20.138, longitude: -99.2015 },
            timestamp: new Date().toISOString(),
        });

        // Actualizar el perfil del usuario
        await setDoc(doc(db, "usuarios", user.uid), {
            ...userData,
            vehicles: [...(userData.vehicles || []), vehicleId],
            activationCodes: [...(userData.activationCodes || []), code],
            purchasedProducts: [...(userData.purchasedProducts || []), `ridersafe-${plan}`],
        });

        return { success: true, plan };
    } catch (error) {
        console.error("[Auth] Error activando código:", error);
        return { success: false, error: "Ocurrió un error al activar el código." };
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