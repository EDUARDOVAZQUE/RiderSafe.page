// reviews.js - Módulo para gestionar el sistema de reseñas con Firebase.

import { db } from "./config/firebase-config.js";
import { getCurrentUser, getUserData } from "./modules/auth.js";
import { collection, doc, addDoc, updateDoc, deleteDoc, query, where, onSnapshot, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

let userReview = null;      // Rastrea la reseña del usuario actual ({ id, data })
let allReviews = [];        // Almacena todas las reseñas para búsquedas rápidas

/**
 * Función principal que inicializa el sistema de reseñas.
 */
export function initReviewSystem() {
    const reviewsContainer = document.getElementById("reviews-container");
    if (!reviewsContainer) return;
    const productId = reviewsContainer.dataset.productId;
    if (!productId) return;
    initializeReviewSection(productId);
}
/**
 * Configura los listeners y la lógica para la sección de reseñas.
 */
function initializeReviewSection(productId) {
    const reviewModalElem = document.getElementById("reviewModal");
    if (!reviewModalElem) return;

    const reviewModal = new window.bootstrap.Modal(reviewModalElem);
    const reviewForm = document.getElementById("reviewForm");
    const submitReviewBtn = document.getElementById("submit-review-btn");
    const addReviewBtn = document.getElementById("add-review-btn");

    if (addReviewBtn) addReviewBtn.disabled = true;

    fetchAndDisplayReviews(productId);

    addReviewBtn.addEventListener("click", () => {
        if (!getCurrentUser()) {
            showAuthRequiredMessage();
            return;
        }
        openReviewModal(userReview ? userReview.data : null);
    });

    submitReviewBtn.addEventListener("click", () => handleReviewSubmit(productId, reviewForm, reviewModal));

    document.getElementById("reviews-list").addEventListener('click', (e) => {
        const editButton = e.target.closest('.btn-edit-review');
        if (editButton) {
            const reviewId = editButton.dataset.reviewId;
            const reviewToEdit = allReviews.find(r => r.id === reviewId);
            if (reviewToEdit) openReviewModal(reviewToEdit.data);
        }

        const deleteButton = e.target.closest('.btn-delete-review');
        if (deleteButton) {
            const reviewId = deleteButton.dataset.reviewId;
            const reviewToDelete = allReviews.find(r => r.id === reviewId);
            if (reviewToDelete) handleDeleteReview(reviewToDelete.id, reviewToDelete.data.name);
        }
    });

    // ✅ CORRECCIÓN: Se añade el listener para los botones de filtro
    document.querySelectorAll(".filter-btn").forEach(button => {
        button.addEventListener("click", function () {
            const starFilter = this.dataset.starFilter;
            document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
            this.classList.add("active");
            
            document.querySelectorAll(".review-item").forEach(review => {
                const matches = starFilter === "all" || review.dataset.stars === starFilter;
                review.classList.toggle('d-none', !matches); // Usa una clase para ocultar, es mejor práctica
            });
        });
    });
}
/**
 * Maneja la lógica de CREAR o ACTUALIZAR una reseña.
 */
async function handleReviewSubmit(productId, form, modal) {
    const feedbackDiv = form.querySelector("#review-feedback");
    const submitBtn = document.getElementById("submit-review-btn");
    const addReviewBtn = document.getElementById("add-review-btn");
    const user = getCurrentUser();

    if (!user || !form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const userData = await getUserData(user.uid);
    const userName = userData?.fullName || user.email;
    
    // ✅ CORRECCIÓN: Se recopilan los datos del formulario aquí
    const reviewData = {
        productId,
        userId: user.uid,
        userEmail: user.email,
        name: userName,
        rating: Number(form.querySelector("#reviewRating").value),
        title: form.querySelector("#reviewTitle").value,
        text: form.querySelector("#reviewMessage").value,
        verified: userData?.purchasedProducts?.includes(productId) || false,
    };

    setButtonLoadingState(submitBtn, true);
    if (addReviewBtn) addReviewBtn.disabled = true;

    try {
        const existingReviewId = await findUserReviewId(productId, user.uid);
        if (existingReviewId) { // EDITANDO
            reviewData.updatedAt = serverTimestamp();
            await updateDoc(doc(db, "reviews", existingReviewId), reviewData);
            feedbackDiv.innerHTML = `<div class="alert alert-success">¡Reseña actualizada!</div>`;
        } else { // CREANDO
            reviewData.createdAt = serverTimestamp();
            await addDoc(collection(db, "reviews"), reviewData);
            feedbackDiv.innerHTML = `<div class="alert alert-success">¡Gracias por tu reseña!</div>`;
        }
        setTimeout(() => modal.hide(), 1500);
    } catch (error) {
        console.error("[Reviews] Error al guardar reseña:", error);
        feedbackDiv.innerHTML = `<div class="alert alert-danger">Error al guardar tu reseña.</div>`;
        if (addReviewBtn) addReviewBtn.disabled = false;
    } finally {
        setButtonLoadingState(submitBtn, false);
    }
}
/**
 * Busca en Firestore una reseña que coincida con el usuario y el producto.
 */
async function findUserReviewId(productId, userId) {
    const q = query(collection(db, "reviews"), where("productId", "==", productId), where("userId", "==", userId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.empty ? null : querySnapshot.docs[0].id;
}

/**
 * ✅ CORRECCIÓN: Obtiene reseñas y actualiza la UI de forma robusta.
 */
function fetchAndDisplayReviews(productId) {
    const reviewsListDiv = document.getElementById("reviews-list");
    const placeholder = document.getElementById("reviews-placeholder");
    const addReviewBtn = document.getElementById("add-review-btn");
    const reviewsQuery = query(collection(db, "reviews"), where("productId", "==", productId));
    const currentUser = getCurrentUser();

    onSnapshot(reviewsQuery, (snapshot) => {
        reviewsListDiv.innerHTML = "";
        userReview = null;
        allReviews = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
        allReviews.sort((a, b) => (b.data.createdAt?.toMillis() || 0) - (a.data.createdAt?.toMillis() || 0));

        if (allReviews.length === 0) {
            placeholder.innerHTML = '<p class="text-center py-5">Aún no hay reseñas. ¡Sé el primero!</p>';
            placeholder.style.display = "block";
        } else {
            placeholder.style.display = "none";
            allReviews.forEach(review => {
                if (currentUser && review.data.userId === currentUser.uid) {
                    userReview = review;
                }
                reviewsListDiv.appendChild(createReviewElement(review.data, review.id));
            });
        }
        
        if (addReviewBtn) {
            addReviewBtn.disabled = false;
            if (userReview) {
                addReviewBtn.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Editar mi reseña`;
                addReviewBtn.classList.remove('btn-primary');
                addReviewBtn.classList.add('btn-outline-secondary');
            } else {
                addReviewBtn.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Escribir una reseña`;
                addReviewBtn.classList.remove('btn-outline-secondary');
                addReviewBtn.classList.add('btn-primary');
            }
        }
        
        updateSummary(allReviews.map(r => r.data));
    }, (error) => {
        console.error("[Reviews] Error al obtener reseñas:", error);
        placeholder.innerHTML = '<p class="text-center text-danger py-5">Error al cargar las reseñas.</p>';
    });
}


async function handleDeleteReview(reviewId, userName) {
    if (confirm(`Hola ${userName}, ¿estás seguro de que quieres eliminar tu reseña? Esta acción no se puede deshacer.`)) {
        try {
            await deleteDoc(doc(db, "reviews", reviewId));
        } catch (error) {
            console.error("[Reviews] Error al eliminar la reseña:", error);
            alert("Hubo un error al intentar eliminar tu reseña.");
        }
    }
}

function openReviewModal(reviewData) {
    const reviewModalElem = document.getElementById("reviewModal");
    const reviewModal = window.bootstrap.Modal.getInstance(reviewModalElem) || new window.bootstrap.Modal(reviewModalElem);
    const form = document.getElementById("reviewForm");
    const title = reviewModalElem.querySelector(".modal-title");
    const submitBtnText = document.getElementById("submit-review-btn").querySelector('.submit-text');

    form.reset();
    form.querySelector("#review-feedback").innerHTML = "";

    if (reviewData) { // MODO EDICIÓN
        title.textContent = "Edita tu opinión";
        submitBtnText.textContent = "Guardar Cambios";
        form.querySelector("#reviewRating").value = reviewData.rating;
        form.querySelector("#reviewTitle").value = reviewData.title;
        form.querySelector("#reviewMessage").value = reviewData.text;
    } else { // MODO CREACIÓN
        title.textContent = "Comparte tu opinión";
        submitBtnText.textContent = "Publicar Reseña";
    }
    reviewModal.show();
}



function createReviewElement(reviewData, reviewId) {
    const div = document.createElement("div");
    div.className = "review-item border-bottom pb-3 mb-3";
    div.dataset.stars = reviewData.rating;

    const starsHTML = Array(5).fill(0).map((_, i) => `<i class="bi bi-star${i < reviewData.rating ? '-fill' : ''}"></i>`).join('');
    const date = reviewData.createdAt?.toDate().toLocaleDateString("es-MX", { dateStyle: "long" }) || "";
    const verifiedBadge = reviewData.verified ? '<span class="badge bg-success ms-2"><i class="bi bi-check-circle"></i> Compra Verificada</span>' : "";
    const currentUser = getCurrentUser();
    
    let actionButtons = '';
    if (currentUser && reviewData.userId === currentUser.uid) {
        actionButtons = `
            <div class="ms-auto">
                <button class="btn btn-sm btn-outline-secondary btn-edit-review" data-review-id="${reviewId}"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger btn-delete-review" data-review-id="${reviewId}"><i class="bi bi-trash"></i></button>
            </div>
        `;
    }

    div.innerHTML = `
        <div class="d-flex align-items-start mb-2">
            <div class="flex-shrink-0 me-3">
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center" style="width: 50px; height: 50px;">
                    <i class="bi bi-person-fill fs-4"></i>
                </div>
            </div>
            <div class="flex-grow-1">
                <h6 class="fw-bold mb-0">${reviewData.name}${verifiedBadge}</h6>
                <small class="text-muted">${date}</small>
            </div>
            ${actionButtons}
        </div>
        <div class="d-flex align-items-center mb-2">
            <div class="text-warning me-2">${starsHTML}</div>
            <h5 class="mb-0">${reviewData.title}</h5>
        </div>
        <p class="mb-0 text-muted">${reviewData.text}</p>
    `;
    return div;
}

/**
 * Actualiza la tarjeta de resumen y el hero del producto.
 */
function updateSummary(reviews) {
    const summaryCard = document.getElementById("reviews-summary-card");
    const heroStarsContainer = document.getElementById("product-hero-stars");
    const heroReviewCount = document.getElementById("product-hero-review-count");

    if (reviews.length === 0) {
        if (summaryCard) summaryCard.classList.add('d-none');
        if (heroReviewCount) heroReviewCount.textContent = "Sé el primero en opinar";
        if (heroStarsContainer) heroStarsContainer.innerHTML = "";
        return;
    }

    const totalReviews = reviews.length;
    const averageRating = (reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1);
    const reviewText = `${totalReviews} reseña${totalReviews !== 1 ? 's' : ''}`;

    const full = Math.floor(averageRating);
    const half = averageRating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    const starsHTML = `${'<i class="bi bi-star-fill"></i>'.repeat(full)}${'<i class="bi bi-star-half"></i>'.repeat(half)}${'<i class="bi bi-star"></i>'.repeat(empty)}`;
    
    if (summaryCard) {
        document.getElementById("average-rating").textContent = averageRating;
        document.getElementById("review-count").textContent = totalReviews;
        document.getElementById("summary-stars").innerHTML = starsHTML;
        summaryCard.classList.remove('d-none');
    }

    if (heroStarsContainer) heroStarsContainer.innerHTML = starsHTML;
    if (heroReviewCount) heroReviewCount.textContent = `(${averageRating}) ${reviewText}`;
}

/**
 * Muestra el modal de autenticación.
 */
function showAuthRequiredMessage() {
    const authModal = document.getElementById("authModal");
    if (authModal && window.bootstrap) {
        new window.bootstrap.Modal(authModal).show();
    } else {
        alert("Debes iniciar sesión para escribir una reseña.");
    }
}

/**
 * Cambia el estado visual de un botón entre normal y cargando.
 */
function setButtonLoadingState(button, isLoading) {
    if (!button) return;
    button.disabled = isLoading;
    const submitText = button.querySelector(".submit-text");
    const spinner = button.querySelector(".spinner-border");
    const loadingText = button.querySelector(".loading-text");

    if (submitText) submitText.style.display = isLoading ? "none" : "inline-block";
    if (spinner) spinner.style.display = isLoading ? "inline-block" : "none";
    if (loadingText) loadingText.style.display = isLoading ? "inline-block" : "none";
}