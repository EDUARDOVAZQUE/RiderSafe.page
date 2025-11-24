// dashboard.js - Módulo del sistema de monitoreo de vehículos RiderSafe

import { db } from "../config/firebase-config.js";
import { doc, onSnapshot, getDoc, collection, updateDoc, GeoPoint, setDoc,getDocs, query, orderBy, limit  } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getCurrentUser, getUserData, activateProductCode } from "./auth.js";
// (El resto de tus imports)
let map, motorcycleMarker, model, scene, camera, renderer;
let followState = true;
let connectionTimeout = null;
let currentVehicleId = null;
let unsubscribeFirestore = null;
let currentVehicleGeofences = [];
let geofenceLayers = [];
let modalMap = null;
let activeEditingGeofence = { marker: null, circle: null };
let historyMapToday = null;
let activeEditingGeofenceSlot = null;
let geofenceModalInstance = null;
let historyMapYesterday = null;
// --- (NUEVO) Variable para la gráfica de batería ---
let batteryChartInstance = null;

function updateHeaderUI(user) {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const dashboardLink = document.getElementById('dashboardLink');

    if (!loginBtn || !logoutBtn || !dashboardLink) {
        // Esto es normal si el header aún no se ha cargado
        console.warn("[Header] No se encontraron los botones de login/logout en el header.");
        return;
    }

    if (user) {
        // Usuario está LOGUEADO
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
        dashboardLink.style.display = 'block';
    } else {
        // Usuario está DESLOGUEADO
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
        dashboardLink.style.display = 'none';
    }
}

async function initDashboard() {
    console.log("[Dashboard] Inicializando...");
    const user = getCurrentUser();
    updateHeaderUI(user);
    if (!user) {
        console.error("[Dashboard] initDashboard llamado sin un usuario autenticado. Deteniendo.");
        return;
    }

    const userData = await getUserData(user.uid);
    if (!userData) {
        console.error("[Dashboard] No se pudieron obtener los datos del usuario.");
        return;
    }

    if (!userData.vehicles || userData.vehicles.length === 0) {
        console.log("[Dashboard] Usuario sin vehículos. Mostrando formulario de activación.");
        showActivationForm();
    } else {
        console.log(`[Dashboard] Usuario con ${userData.vehicles.length} vehículo(s).`);
        showDashboardView();
        initializeAllComponents();
        await populateVehicleDropdown(userData.vehicles);
    }
}

function showActivationForm() {
    const activationSection = document.getElementById("activation-section");
    const dashboardSection = document.getElementById("dashboard-section");
    if (activationSection) activationSection.style.display = "block";
    if (dashboardSection) dashboardSection.style.display = "none";

    const activationForm = document.getElementById("activation-form");
    if (activationForm) {
        activationForm.onsubmit = handleActivationSubmit;

        let cancelBtn = document.getElementById("cancel-activation");
        if (!cancelBtn) {
            cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.id = "cancel-activation";
            cancelBtn.className = "btn btn-secondary btn-lg w-100 mt-2";
            cancelBtn.textContent = "Cancelar";
            activationForm.appendChild(cancelBtn);
        }

        cancelBtn.onclick = () => {
            if (currentVehicleId) {
                showDashboardView();
                const vehicleSelect = document.getElementById("vehicle-select");
                vehicleSelect.value = currentVehicleId;
            }
        };
    }
}

function showDashboardView() {
    const activationSection = document.getElementById("activation-section");
    const dashboardSection = document.getElementById("dashboard-section");
    if (activationSection) activationSection.style.display = "none";
    if (dashboardSection) dashboardSection.style.display = "block";
}

async function handleActivationSubmit(e) {
    e.preventDefault();
    const codeInput = document.getElementById("activation-code");
    const errorMsg = document.getElementById("activation-error");
    const successMsg = document.getElementById("activation-success");
    const code = codeInput.value.trim();

    if (!code) {
        errorMsg.textContent = "Por favor, ingresa un código de activación.";
        errorMsg.style.display = "block";
        return;
    }

    const result = await activateProductCode(code);
    if (result.success) {
        successMsg.textContent = `¡Código activado! Plan ${result.plan.toUpperCase()} registrado. Recargando...`;
        successMsg.style.display = "block";
        errorMsg.style.display = "none";
        setTimeout(() => window.location.reload(), 2500);
    } else {
        errorMsg.textContent = result.error;
        errorMsg.style.display = "block";
        successMsg.style.display = "none";
    }
}

function initializeAllComponents() {
    updateUIWithDefaults();
    initMap();
    init3D();
    setupEventListeners();
}

async function populateVehicleDropdown(vehicleIds) {
    const vehicleSelect = document.getElementById("vehicle-select");
    vehicleSelect.innerHTML = "";

    const addOption = new Option("✚ Agregar vehículo...", "add-new-vehicle");
    vehicleSelect.add(addOption);

    const vehiclePromises = vehicleIds.map(async (id) => {
        try {
            const docRef = doc(db, "dispositivos", id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const friendlyName = docSnap.data().friendlyName || id;
                return { id, name: friendlyName };
            }
            return null;
        } catch (error) {
            console.error(`Error al cargar datos del vehículo ${id}:`, error);
            return null;
        }
    });

    const vehicles = (await Promise.all(vehiclePromises)).filter((v) => v !== null);

    vehicles.forEach((vehicle) => {
        const option = new Option(vehicle.name, vehicle.id);
        vehicleSelect.add(option);
    });

    if (vehicles.length > 0) {
        const firstVehicleId = vehicles[0].id;
        vehicleSelect.value = firstVehicleId;
        await switchVehicle(firstVehicleId);
    }
}

async function switchVehicle(vehicleId) {
    if (!vehicleId) return;

    if (vehicleId === "add-new-vehicle") {
        showActivationForm();
        return;
    }

    console.log(`[Dashboard] Cambiando a vehículo: ${vehicleId}`);
    currentVehicleId = vehicleId;

    if (unsubscribeFirestore) {
        console.log("[Firestore] Deteniendo listener anterior.");
        unsubscribeFirestore();
        unsubscribeFirestore = null;
    }

    updateUIWithDefaults();
    setupFirestoreListener(vehicleId);
    loadVehicleHistory(vehicleId);
}

function setupFirestoreListener(vehicleId) {
    if (!vehicleId) {
        console.error("El ID del vehículo es inválido. No se puede escuchar actualizaciones.");
        return;
    }

    console.log(`[Firestore] Escuchando en tiempo real: /dispositivos/${vehicleId}`);
    const docRef = doc(db, "dispositivos", vehicleId);

    unsubscribeFirestore = onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();

            clearTimeout(connectionTimeout);
            updateConnectionStatus(true);
            connectionTimeout = setTimeout(() => {
                console.warn("[Firestore] Timeout: No se han recibido datos en 10 segundos.");
                updateConnectionStatus(false);
            }, 10000);

            const newGeofences = parseGeofencesFromDoc(data);
            updateUIFromData(data, newGeofences);

        } else {
            console.error(`El documento /dispositivos/${vehicleId} no existe.`);
            updateConnectionStatus(false);
            updateUIWithDefaults();
        }
    }, (error) => {
        console.error("Error en la escucha de Firestore:", error);
        updateConnectionStatus(false);
    });
}

function setupEventListeners() {
    const followCheckbox = document.getElementById("follow-checkbox");
    if (followCheckbox) {
        followCheckbox.addEventListener("change", (event) => {
            followState = event.target.checked;
        });
    }

    const vehicleSelect = document.getElementById("vehicle-select");
    if (vehicleSelect) {
        vehicleSelect.addEventListener("change", (e) => {
            const newVehicleId = e.target.value;
            switchVehicle(newVehicleId);
        });
    }

    setupModal();
    const editBtn = document.getElementById('edit-name-btn');
    const saveBtn = document.getElementById('save-name-btn');
    const cancelBtn = document.getElementById('cancel-name-btn');
    
    if (editBtn) {
        editBtn.onclick = () => toggleVehicleNameEdit(true);
    }
    if (saveBtn) {
        saveBtn.onclick = () => handleSaveVehicleName();
    }
    if (cancelBtn) {
        cancelBtn.onclick = () => toggleVehicleNameEdit(false);
    }
}
// --- Listener para el botón de Demo ---
   // --- Listener para el botón de Demo ---
    const demoBtn = document.getElementById('run-demo-btn');
    if (demoBtn) {
        demoBtn.onclick = () => {
            
            // 1. DESBLOQUEO FORZOSO DE AUDIO
            // Esto DEBE ocurrir aquí, directo en el clic, antes de cualquier confirm() o async
            notificationSound.play()
                .then(() => {
                    notificationSound.pause();
                    notificationSound.currentTime = 0;
                    console.log("🔊 Audio desbloqueado correctamente.");
                })
                .catch(e => console.warn("⚠️ No se pudo desbloquear audio:", e));

            // 2. Pedir confirmación
            if (confirm("¿Iniciar simulación de ruta? Esto sobrescribirá el historial de 'Hoy' para este vehículo.")) {
                runDemoRoute();
            }
        };
    }
function updateUIWithDefaults() {
    updateBattery(0);
    updateSpeed(0);
    updateModelTilt(0);
    updateSliderUI(0);
    updateConnectionStatus(false);
    currentVehicleGeofences = [];
    updateGeofenceListUI([]);
    drawGeofencesOnMap([]);
    clearHistoryUI();
}




// --- PASO 2: Modificado para aceptar 'geofences' como parámetro ---
function updateUIFromData(data, geofences) {
    // (Req 2) Si un valor no existe, se usa 0
    updateBattery(data.bateria || 0);
    updateSpeed(data.velocidad || 0);
    updateModelTilt(data.inclinacion || 0);
    updateSliderUI(data.inclinacion || 0);

    const displayName = data.friendlyName || currentVehicleId; // Usar ID si no hay nombre
    const nameDisplay = document.getElementById('vehicle-name-display');
    if (nameDisplay) {
        nameDisplay.textContent = displayName;
    }
    // (Poner el nombre en el input de edición también, para que esté listo si edita)
    const nameInput = document.getElementById('vehicle-name-input');
    if (nameInput) {
        nameInput.value = displayName;
    }

    if (data.ubicacion && data.ubicacion.latitude && data.ubicacion.longitude) {
        updateMapLocation(data.ubicacion.latitude, data.ubicacion.longitude);

        // --- Lógica clave ---
        // Pasa las geocercas (el array) a checkGeofences
        checkGeofences(data.ubicacion.latitude, data.ubicacion.longitude, geofences);
    } else {
        // No hay ubicación, no se pueden chequear geocercas, pero sí dibujarlas
        checkGeofences(null, null, geofences);
    }

    // Evitar redibujar si la configuración no ha cambiado
    const oldGeoSignature = currentVehicleGeofences
        .map(g => `${g.id}${g.name}${g.radius}${g.lat}${g.lon}${g.active}`)
        .join();
    const newGeoSignature = geofences
        .map(g => `${g.id}${g.name}${g.radius}${g.lat}${g.lon}${g.active}`)
        .join();

    if (oldGeoSignature !== newGeoSignature) {
        console.log("[Geofence] Detectado cambio en la configuración de geocercas, redibujando.");
        updateGeofenceListUI(geofences);
        drawGeofencesOnMap(geofences);
        loadGeofencesInModal(geofences);
    }

    currentVehicleGeofences = geofences;
}


function updateBattery(percentage) {
    document.getElementById("batteryLevel").style.width = `${percentage}%`;
    document.getElementById("batteryPercent").textContent = `${percentage}%`;
}

function updateSpeed(speed) {
    document.getElementById("speedDisplay").textContent = speed;
}

function updateConnectionStatus(isConnected) {
    const dot = document.getElementById("deviceConnection");
    const text = document.getElementById("deviceStatusText");
    if (isConnected) {
        dot.className = "connection-dot connected";
        text.textContent = "Conectado";
    } else {
        dot.className = "connection-dot disconnected";
        text.textContent = "Desconectado";
    }
}

function updateSliderUI(value) {
    const slider = document.getElementById("tiltSlider");
    const valueText = document.getElementById("sliderValue");
    let color = "#f56565";
    if (value >= -20 && value <= 20) color = "#48bb78";
    else if ((value > 20 && value <= 45) || (value < -20 && value >= -45)) color = "#ed8936";
    slider.value = value;
    valueText.textContent = `${value}°`;
    valueText.style.color = color;
}

function initMap() {
    const defaultLocation = [20.1380, -99.2015];
    map = L.map("map").setView(defaultLocation, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    const motorcycleIcon = L.divIcon({
        html: "🏍️",
        className: "leaflet-div-icon",
        iconSize: [50, 50],
        iconAnchor: [50, 50]
    });
    motorcycleMarker = L.marker(defaultLocation, { icon: motorcycleIcon }).addTo(map);
    drawGeofencesOnMap();
}

function updateMapLocation(lat, lng) {
    const newPosition = [lat, lng];
    if (motorcycleMarker) {
        motorcycleMarker.setLatLng(newPosition);
        if (followState) map.panTo(newPosition);
    }
}

function init3D() {
    const container = document.getElementById("3Dmodel");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF0F0F0);
    camera = new THREE.PerspectiveCamera(19, 400 / 300, 10, 300);
    camera.position.set(-14, 14, 0);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(400, 300);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    const loader = new THREE.FBXLoader();
    loader.load("./motorexp.fbx", (object) => {
        model = object;
        model.scale.set(0.6, 0.6, 0.6);
        model.position.set(2, -2.5, 0);
        scene.add(model);
    }, undefined, (error) => console.error("Error al cargar el modelo 3D:", error));

    animate3D();
}

function updateModelTilt(value) {
    if (model) model.rotation.x = (value * Math.PI) / 180;
}

function animate3D() {
    requestAnimationFrame(animate3D);
    renderer.render(scene, camera);
}

function centerGeofence(index) {
    if (currentVehicleGeofences && currentVehicleGeofences[index]) {
        const fence = currentVehicleGeofences[index];
        document.getElementById("follow-checkbox").checked = false;
        followState = false;
        map.flyTo([fence.lat, fence.lon], 16);
    } else {
        console.error(`No se encontró la geocerca ${index} en currentVehicleGeofences.`);
    }
}

window.centerGeofence = centerGeofence;

function parseGeofencesFromDoc(data) {
    const geofences = [];
    for (let i = 1; i <= 3; i++) {
        const geoPoint = data[`geo${i}`];
        const geoName = data[`geo${i}_name`];
        const geoRadius = data[`geo${i}_radius`];
        const geoActive = data[`geo${i}_active`];

        if (geoPoint && geoPoint.latitude && geoName && geoRadius) {
            geofences.push({
                id: `geo${i}`,
                name: geoName,
                lat: geoPoint.latitude,
                lon: geoPoint.longitude,
                radius: geoRadius,
                active: geoActive || false,
                isInside: false
            });
        }
    }
    return geofences;
}

// --- (MODIFICADO) PASO 2: Tu función 'checkGeofences' ---
// Ahora acepta 'geofences' como parámetro
function checkGeofences(lat, lon, geofences) {
    const oldGeofences = currentVehicleGeofences;

    // --- ESTA ES LA LÓGICA CLAVE ---
    // 4. Itera sobre el array 'geofences' (el parámetro)
    //    en lugar del array global que ya no existe.
    geofences.forEach((fence, index) => {
        if (!lat || !lon || !fence.active) {
            fence.isInside = false;
            updateGeofenceUI(index, false);
            return; 
        }
        
        const distance = getDistance(lat, lon, fence.lat, fence.lon);
        const wasInside = oldGeofences[index] ? oldGeofences[index].isInside : false;
        const isNowInside = distance <= fence.radius;

        if (isNowInside && !wasInside) {
            fence.isInside = true;
            showAlert(`Entrando a ${fence.name}`, "enter");
        } else if (!isNowInside && wasInside) {
            fence.isInside = false;
            showAlert(`Saliendo de ${fence.name}`, "exit");
        } else {
            fence.isInside = wasInside; 
        }
        
        updateGeofenceUI(index, fence.isInside);
    });
}

function updateGeofenceListUI(geofences) {
    const listContainer = document.querySelector(".geofence-list-new");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    if (!geofences || geofences.length === 0) {
        listContainer.innerHTML = `
            <p class="text-muted small px-2">
                No hay geocercas configuradas. Haz clic en "Editar / Crear" para añadir una.
            </p>`;
        return;
    }

    geofences.forEach((geo, index) => {
        const statusClass = geo.isInside ? "inside" : "outside";
        const statusText = geo.isInside ? "Dentro" : "Fuera";
        const checkedStatus = geo.active ? "checked" : "";

        const geofenceHTML = `
            <div class="card mb-2" id="geofence-item-${index}">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-0 geofence-name">${geo.name}</h6>
                            <small class="text-muted">Circular - ${geo.radius}m</small>
                        </div>
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" role="switch"
                                id="geofence-toggle-${index}" ${checkedStatus}>
                        </div>
                        <div id="geofence-status-${index}" class="geofence-status ${statusClass}">
                            ${statusText}
                        </div>
                        <button class="btn btn-sm btn-outline-secondary"
                            onclick="window.centerGeofence(${index})">
                            <i class="bi bi-eye"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        listContainer.insertAdjacentHTML("beforeend", geofenceHTML);
    });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function drawGeofencesOnMap(geofences) {
    if (!map) return;
    geofenceLayers.forEach(layer => map.removeLayer(layer));
    geofenceLayers = [];
    if (!geofences) return;

    geofences.forEach(fence => {
        if (!fence.active) return;
        const circle = L.circle([fence.lat, fence.lon], {
            color: "#4299e1",
            fillColor: "#4299e1",
            fillOpacity: 0.2,
            radius: fence.radius
        }).addTo(map);
        geofenceLayers.push(circle);
    });
}

function updateGeofenceUI(index, isInside) {
    const statusEl = document.getElementById(`geofence-status-${index}`);
    if (statusEl) {
        statusEl.textContent = isInside ? "Dentro" : "Fuera";
        statusEl.className = `geofence-status ${isInside ? "inside" : "outside"}`;
    }
}


function setupModal() {
    const modalEl = document.getElementById("geofenceModal");
    const openBtn = document.getElementById("openModalBtn");
    const saveBtn = document.getElementById("save-geofence-btn");
    const newBtn = document.getElementById("new-geofence-btn");
    const select = document.getElementById("geofence-select");
    const radiusInput = document.getElementById("geofence-radius-input");
    const latInput = document.getElementById("geofence-lat-input");
    const lngInput = document.getElementById("geofence-lng-input");

    if (!modalEl || !openBtn || !saveBtn || !newBtn || !select || !radiusInput || !latInput || !lngInput) {
        console.error("Error al inicializar el modal. Faltan elementos del DOM.");
        return;
    }

    geofenceModalInstance = new bootstrap.Modal(modalEl);

    openBtn.onclick = () => {
        loadGeofencesInModal(currentVehicleGeofences);
        geofenceModalInstance.show();
    };

    modalEl.addEventListener("shown.bs.modal", () => {
        initModalMap();
        const selectedIndex = document.getElementById("geofence-select").value;
        loadGeofenceInModalEditor(Number(selectedIndex));
    });

    select.onchange = e => loadGeofenceInModalEditor(Number(e.target.value));
    newBtn.onclick = handleNewGeofence;
    saveBtn.onclick = handleSaveGeofence;

    radiusInput.oninput = e => {
        if (activeEditingGeofence.circle) {
            activeEditingGeofence.circle.setRadius(Number(e.target.value) || 0);
        }
    };

    latInput.oninput = updateModalMarkerFromInputs;
    lngInput.oninput = updateModalMarkerFromInputs;
}


function initModalMap() {
    // Si el mapa ya existe, solo ajusta su tamaño
    if (modalMap) {
        modalMap.invalidateSize();
        return;
    }
    
    // Si no existe, créalo
    const defaultCenter = [19.4326, -99.1332]; // CDMX
    modalMap = L.map("modal-map").setView(defaultCenter, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(modalMap);
}

function loadGeofencesInModal(geofences) {
    const select = document.getElementById("geofence-select");
    const newBtn = document.getElementById("new-geofence-btn");
    select.innerHTML = "";

    if (geofences && geofences.length > 0) {
        geofences.forEach((fence, index) => {
            select.appendChild(new Option(fence.name, index));
        });
        loadGeofenceInModalEditor(0);
        select.disabled = false;
    } else {
        select.appendChild(new Option("Crea tu primera geocerca", -1));
        select.disabled = true;
        handleNewGeofence();
    }

    newBtn.disabled = geofences.length >= 3;
}

function handleNewGeofence() {
    const usedSlots = currentVehicleGeofences.map(g => g.id);
    let freeSlot = null;

    for (let i = 1; i <= 3; i++) {
        if (!usedSlots.includes(`geo${i}`)) {
            freeSlot = `geo${i}`;
            break;
        }
    }

    if (!freeSlot) {
        showGeofenceModalAlert("error", "Solo puedes tener un máximo de 3 geocercas.");
        return;
    }

    console.log(`[Geofence] Creando nueva geocerca en el slot: ${freeSlot}`);
    activeEditingGeofenceSlot = freeSlot;

    if (activeEditingGeofence.marker) modalMap.removeLayer(activeEditingGeofence.marker);
    if (activeEditingGeofence.circle) modalMap.removeLayer(activeEditingGeofence.circle);

    const nameInput = document.getElementById("geofence-name-input");
    const radiusInput = document.getElementById("geofence-radius-input");
    const latInput = document.getElementById("geofence-lat-input");
    const lngInput = document.getElementById("geofence-lng-input");

    document.getElementById("geofence-select").disabled = true;
    nameInput.value = "Nueva Geocerca";
    radiusInput.value = 100;

    const center = modalMap.getCenter();
    latInput.value = center.lat.toFixed(6);
    lngInput.value = center.lng.toFixed(6);

    activeEditingGeofence.circle = L.circle(center, { radius: 100 }).addTo(modalMap);
    activeEditingGeofence.marker = L.marker(center, { draggable: true }).addTo(modalMap);

    activeEditingGeofence.marker.on("dragend", (e) => {
        const { lat, lng } = e.target.getLatLng();
        activeEditingGeofence.circle.setLatLng([lat, lng]);
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
    });
}


function loadGeofenceInModalEditor(index) {
    if (!modalMap) return;

    const nameInput = document.getElementById("geofence-name-input");
    const radiusInput = document.getElementById("geofence-radius-input");
    const latInput = document.getElementById("geofence-lat-input");
    const lngInput = document.getElementById("geofence-lng-input");

    // Limpiar marcador y círculo previos
    if (activeEditingGeofence.marker) modalMap.removeLayer(activeEditingGeofence.marker);
    if (activeEditingGeofence.circle) modalMap.removeLayer(activeEditingGeofence.circle);
    activeEditingGeofence.marker = null;
    activeEditingGeofence.circle = null;

    // Si no hay geocerca seleccionada
    if (index === -1) {
        nameInput.value = "";
        radiusInput.value = 100;
        latInput.value = "";
        lngInput.value = "";
        activeEditingGeofenceSlot = null;
        return;
    }

    const fence = currentVehicleGeofences[index];
    if (!fence) return;

    activeEditingGeofenceSlot = fence.id;

    document.getElementById("geofence-select").value = index;
    nameInput.value = fence.name;
    radiusInput.value = fence.radius;
    latInput.value = fence.lat;
    lngInput.value = fence.lon;

    const center = [fence.lat, fence.lon];
    activeEditingGeofence.circle = L.circle(center, { radius: fence.radius }).addTo(modalMap);
    activeEditingGeofence.marker = L.marker(center, { draggable: true }).addTo(modalMap);
    modalMap.setView(center, 16);

    // Actualizar inputs al arrastrar marcador
    activeEditingGeofence.marker.on("dragend", (e) => {
        const { lat, lng } = e.target.getLatLng();
        activeEditingGeofence.circle.setLatLng([lat, lng]);
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
    });
}


const audioBase64 = "data:audio/mp3;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAZGFzaABUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAA2NvbXBhdGlibGVfYnJhbmRzAGlzbzZtcDQxAFRTU0UAAAAPAAADTGF2ZjU5LjI3LjEwMAAAAAAAAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAABDQVNNZTMuMTAwiuQAAAAAAFILAAALAAAAAAA//uQZAAABHAywAAAAAAAAM8AAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA//uQZAAAAAAAALAAAAAAAALAAAAAAAABAAABAAAAAAAAAAABAAAAAAAA";

const notificationSound = new Audio(audioBase64);
notificationSound.volume = 0.6; // Volumen al 60%

function showAlert(message, type) {
    const container = document.getElementById("alert-container");
    if (!container) return;

    // 1. Reproducir Sonido (Solo si el navegador lo permite)
    notificationSound.currentTime = 0;
    notificationSound.play().catch(error => {
        // Ignoramos el error silenciosamente si aún no se ha interactuado
        // Pero como usamos Base64, es menos probable que falle por red.
        console.log("Audio esperando interacción del usuario."); 
    });

    // 2. Crear la Alerta Visual
    const alertDiv = document.createElement("div");
    alertDiv.className = `alert-toast ${type}`;
    
    let iconHtml = '';
    if (type === 'error') iconHtml = '<i class="bi bi-exclamation-circle-fill me-2 fs-5"></i>';
    else if (type === 'success') iconHtml = '<i class="bi bi-check-circle-fill me-2 fs-5"></i>';
    else if (type === 'enter') iconHtml = '<i class="bi bi-geo-alt-fill me-2 fs-5"></i>';
    else if (type === 'exit') iconHtml = '<i class="bi bi-box-arrow-right me-2 fs-5"></i>';

    alertDiv.innerHTML = `${iconHtml}<div>${message}</div>`;
    
    container.appendChild(alertDiv);

    setTimeout(() => alertDiv.classList.add("show"), 10);
    setTimeout(() => {
        alertDiv.classList.remove("show");
        alertDiv.addEventListener("transitionend", () => alertDiv.remove());
    }, 5000);
}

function clearHistoryUI() {
    const historyContainer = document.getElementById('history-content');
    if (historyContainer) {
        historyContainer.innerHTML = `
            <div class="container py-4">
                <p class="text-muted">Cargando historial...</p>
            </div>
        `;
    }
    if (historyMapToday) {
        historyMapToday.remove();
        historyMapToday = null;
    }
    if (historyMapYesterday) {
        historyMapYesterday.remove();
        historyMapYesterday = null;
    }
}

function getFormattedDate(date) {
    return date.toISOString().split('T')[0];
}

function createEmptyHistoryDay(dayName) {
    return {
        summary: {
            title: `Sin Ruta Registrada (${dayName})`,
            distance: '0 km',
            maxSpeed: '0 km/h'
        },
        routePoints: []
    };
}

async function loadVehicleHistory(vehicleId) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayId = getFormattedDate(today);
    const yesterdayId = getFormattedDate(yesterday);

    try {
        const todayDocRef = doc(db, "dispositivos", vehicleId, "history_days", todayId);
        const yesterdayDocRef = doc(db, "dispositivos", vehicleId, "history_days", yesterdayId);
        const [todaySnap, yesterdaySnap] = await Promise.all([
            getDoc(todayDocRef),
            getDoc(yesterdayDocRef)
        ]);
        const historyData = {
            today: todaySnap.exists() ? todaySnap.data() : createEmptyHistoryDay('Hoy'),
            yesterday: yesterdaySnap.exists() ? yesterdaySnap.data() : createEmptyHistoryDay('Ayer')
        };
        updateHistoryTabs(historyData);
    } catch (error) {
        console.error("Error al cargar el historial:", error);
        document.getElementById('history-content').innerHTML = `
            <div class="container py-4">
                <p class="text-danger">No se pudo cargar el historial.</p>
                <small class="text-muted">${error.message}</small>
            </div>
        `;
    }
}

/**
 * (MODIFICADO) Re-dibuja la sección de Historial con 3 pestañas: Hoy, Ayer, Análisis.
 */
function updateHistoryTabs(historyData) {
    const historyContainer = document.getElementById('history-content');
    if (!historyContainer) return;

    // 1. Destruir gráfica anterior si existe
    if (batteryChartInstance) {
        batteryChartInstance.destroy();
        batteryChartInstance = null;
    }

    // 2. Generar HTML con 3 pestañas
    historyContainer.innerHTML = `
        <div class="container py-4">
            <ul class="nav nav-pills mb-3" id="history-day-tab" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active" id="history-today-tab" data-bs-toggle="pill" data-bs-target="#history-today-pane" type="button" role="tab">Hoy</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="history-yesterday-tab" data-bs-toggle="pill" data-bs-target="#history-yesterday-pane" type="button" role="tab">Ayer</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="history-analysis-tab" data-bs-toggle="pill" data-bs-target="#history-analysis-pane" type="button" role="tab">
                        <i class="bi bi-bar-chart-line"></i> Análisis
                    </button>
                </li>
            </ul>

            <div class="tab-content" id="history-day-tabContent">
                <div class="tab-pane fade show active" id="history-today-pane" role="tabpanel"></div>
                
                <div class="tab-pane fade" id="history-yesterday-pane" role="tabpanel"></div>

                <div class="tab-pane fade" id="history-analysis-pane" role="tabpanel">
                    <div class="text-center py-5"><div class="spinner-border text-primary"></div><p>Cargando datos de sensores...</p></div>
                </div>
            </div>
        </div>
    `;

    // 3. Llenar Hoy y Ayer (Tu código anterior)
    const todayPane = document.getElementById('history-today-pane');
    const yesterdayPane = document.getElementById('history-yesterday-pane');
    todayPane.innerHTML = generateHistoryPaneHTML('today', historyData.today);
    yesterdayPane.innerHTML = generateHistoryPaneHTML('yesterday', historyData.yesterday);

    // 4. Inicializar mapas
    initHistoryMap('history-map-today', historyData.today.routePoints, 'historyMapToday');
    const yesterdayTabEl = document.getElementById('history-yesterday-tab');
    if (yesterdayTabEl) {
        yesterdayTabEl.addEventListener('shown.bs.tab', () => {
            initHistoryMap('history-map-yesterday', historyData.yesterday.routePoints, 'historyMapYesterday');
        }, { once: true });
    }

    // 5. (NUEVO) Listener para cargar Análisis cuando se haga clic en la pestaña
    const analysisTabEl = document.getElementById('history-analysis-tab');
    if (analysisTabEl) {
        analysisTabEl.addEventListener('shown.bs.tab', () => {
            loadAnalysisData(currentVehicleId);
        }); // No usamos 'once: true' para poder recargar si se quiere
    }
}
function generateHistoryPaneHTML(dayId, dayData) {
    let pointsListHTML = '';

    if (dayData.routePoints && dayData.routePoints.length > 0) {
        pointsListHTML = dayData.routePoints.map(point => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                ${point.name}
                <span class="badge bg-primary rounded-pill">${point.duration}</span>
            </li>
        `).join('');
    } else {
        pointsListHTML = '<li class="list-group-item text-muted">No se registraron paradas.</li>';
    }

    const vehicleSelect = document.getElementById('vehicle-select');
    const vehicleName = vehicleSelect.options[vehicleSelect.selectedIndex].text;
    const title = dayId === 'today' ? `Ruta de Hoy: ${vehicleName}` : `Ruta de Ayer: ${vehicleName}`;

    return `
        <div class="row">
            <div class="col-lg-7 mb-3 mb-lg-0">
                <h5 class="mb-3">${title}</h5>
                <div id="history-map-${dayId}" class="bg-light border rounded" style="min-height: 400px; width: 100%;">
                    ${(dayData.routePoints.length === 0) ? '<div class="p-3 text-muted">No hay ruta para mostrar.</div>' : ''}
                </div>
            </div>
            <div class="col-lg-5">
                <h5 class="mb-3">Paradas y Duración</h5>
                <ul class="list-group" style="max-height: 400px; overflow-y: auto;">
                    ${pointsListHTML}
                </ul>
                <div class="card shadow-sm mt-3">
                    <div class="card-body">
                        <h6 class="card-title">Resumen del Día</h6>
                        <p class="card-text mb-1">Distancia: ${dayData.summary.distance}</p>
                        <p class="card-text mb-0">Velocidad Máx: ${dayData.summary.maxSpeed}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initHistoryMap(mapId, points, mapInstanceVar) {
    if (!points || points.length === 0) {
        console.log(`[History] No hay puntos de ruta para el mapa ${mapId}.`);
        return;
    }

    if (mapInstanceVar === 'historyMapToday' && historyMapToday) return;
    if (mapInstanceVar === 'historyMapYesterday' && historyMapYesterday) return;

    try {
        const map = L.map(mapId).setView([points[0].lat, points[0].lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        const latLngs = points.map(p => [p.lat, p.lng]);
        L.polyline(latLngs, { color: 'blue' }).addTo(map);

        points.forEach(p => {
            L.marker([p.lat, p.lng]).addTo(map)
                .bindPopup(`<b>${p.name}</b><br>Duración: ${p.duration}`);
        });

        map.fitBounds(L.polyline(latLngs).getBounds());

        if (mapInstanceVar === 'historyMapToday') {
            historyMapToday = map;
        } else if (mapInstanceVar === 'historyMapYesterday') {
            historyMapYesterday = map;
        }

    } catch (e) {
        console.error(`Error inicializando el mapa ${mapId}:`, e);
        const mapEl = document.getElementById(mapId);
        if (mapEl) mapEl.innerHTML = `<div class="p-3 text-danger">Error al cargar el mapa.</div>`;
    }
}

async function handleSaveGeofence() {
    showGeofenceModalAlert("clear", "");

    if (!currentVehicleId) return showGeofenceModalAlert("error", "No hay un vehículo seleccionado.");
    if (!activeEditingGeofenceSlot) return showGeofenceModalAlert("error", "No hay una geocerca seleccionada para guardar.");

    const lat = Number(document.getElementById("geofence-lat-input").value);
    const lng = Number(document.getElementById("geofence-lng-input").value);
    const name = document.getElementById("geofence-name-input").value;
    const radius = Number(document.getElementById("geofence-radius-input").value);
    const slotId = activeEditingGeofenceSlot;

    if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180)
        return showGeofenceModalAlert("error", "Latitud (-90 a 90) o Longitud (-180 a 180) inválida.");
    if (!name) return showGeofenceModalAlert("error", "El nombre no puede estar vacío.");
    if (radius < 50) return showGeofenceModalAlert("error", "El radio mínimo es de 50 metros.");

    const payload = {
        [slotId]: new GeoPoint(lat, lng),
        [`${slotId}_name`]: name,
        [`${slotId}_radius`]: radius,
        [`${slotId}_active`]: true
    };

    console.log(`[Geofence] Guardando en Firebase: /dispositivos/${currentVehicleId}`, payload);

    try {
        const docRef = doc(db, "dispositivos", currentVehicleId);
        await updateDoc(docRef, payload);

        showGeofenceModalAlert("success", "Geocerca guardada con éxito.");

        setTimeout(() => {
            geofenceModalInstance.hide();
        }, 1000);
    } catch (error) {
        console.error("Error al guardar geocerca:", error);
        showGeofenceModalAlert("error", `Error al guardar: ${error.message}`);
    }
}


function updateModalMarkerFromInputs() {
    const lat = Number(document.getElementById("geofence-lat-input").value);
    const lng = Number(document.getElementById("geofence-lng-input").value);
    
    // Verificar que sean números válidos
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        const newLatLng = [lat, lng];
        if (activeEditingGeofence.marker) {
            // Mover el marcador y el círculo existentes
            activeEditingGeofence.marker.setLatLng(newLatLng);
            activeEditingGeofence.circle.setLatLng(newLatLng);
            modalMap.panTo(newLatLng); // Centrar el mapa
        }
    }
}

function showGeofenceModalAlert(type, message) {
    const errorAlert = document.getElementById("geofence-modal-error");
    const successAlert = document.getElementById("geofence-modal-success");

    errorAlert.style.display = "none";
    successAlert.style.display = "none";

    if (type === "error") {
        errorAlert.textContent = message;
        errorAlert.style.display = "block";
    } else if (type === "success") {
        successAlert.textContent = message;
        successAlert.style.display = "block";
    }
}

function toggleVehicleNameEdit(isEditing) {
    const view = document.getElementById("vehicle-name-view");
    const edit = document.getElementById("vehicle-name-edit");
    const input = document.getElementById("vehicle-name-input");
    const display = document.getElementById("vehicle-name-display");

    if (!view || !edit || !input || !display) return;

    if (isEditing) {
        view.style.display = "none";
        edit.style.display = "flex";
        input.value = display.textContent;
        input.focus();
    } else {
        view.style.display = "flex";
        edit.style.display = "none";
    }
}

async function handleSaveVehicleName() {
    const input = document.getElementById("vehicle-name-input");
    const newName = input.value.trim();

    if (!newName) return showAlert("El nombre no puede estar vacío.", "error");
    if (!currentVehicleId) return showAlert("No hay un vehículo seleccionado.", "error");

    try {
        const ref = doc(db, "dispositivos", currentVehicleId);
        await updateDoc(ref, { friendlyName: newName });

        updateVehicleNameInDropdown(currentVehicleId, newName);
        const display = document.getElementById("vehicle-name-display");
        if (display) display.textContent = newName;

        toggleVehicleNameEdit(false);
        showAlert("Nombre actualizado con éxito.", "success");
    } catch (e) {
        console.error("Error al guardar el nombre:", e);
        showAlert(`Error al guardar: ${e.message}`, "error");
    }
}

function updateVehicleNameInDropdown(vehicleId, newName) {
    const select = document.getElementById("vehicle-select");
    if (!select) return;
    const option = select.querySelector(`option[value="${vehicleId}"]`);
    if (option) option.textContent = newName;
}


/**
 * (NUEVO) Helper para crear pausas (ej: await sleep(1000))
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * (NUEVO) PASO 7: Simula una ruta de A a B, actualiza la UI y guarda en el historial.
 */
// --- (REEMPLAZO) PASO 5 (Workaround): Demo que genera historial de sensores ---

/**
 * Simula una ruta y genera datos históricos (Pings y Eventos) 
 * para poder probar las gráficas sin usar Cloud Functions.
 */
// --- (REEMPLAZO) PASO 7 V2: Demo con Ruta Real y Eventos Aleatorios ---

/**
 * Simula una ruta compleja basada en GeoJSON y genera eventos aleatorios.
 */
async function runDemoRoute() {
    const demoBtn = document.getElementById('run-demo-btn');
    
    // 1. Validar
    if (!currentVehicleId) {
        showAlert("Por favor, selecciona un vehículo primero.", "error");
        return;
    }
    if (demoBtn) demoBtn.disabled = true;

    console.log(`--- 🧪 INICIANDO DEMO REALISTA para ${currentVehicleId} ---`);

    // 2. Ruta GeoJSON (Tu ruta proporcionada)
    // Formato GeoJSON original: [Longitud, Latitud]
    const geoJsonPath = [
        [-99.22082,20.20428],[-99.22073,20.20485],[-99.2206,20.20528],[-99.22051,20.20567],
        [-99.22051,20.20567],[-99.2204,20.20572],[-99.22023,20.20579],[-99.22018,20.20581],
        [-99.22011,20.20581],[-99.22002,20.2058],[-99.22002,20.2058],[-99.21988,20.20577],
        [-99.21969,20.20653],[-99.2194,20.20795],[-99.21914,20.20942],[-99.21914,20.20942],
        [-99.21792,20.21632],[-99.21767,20.21779],[-99.21755,20.2184],[-99.21716,20.22032],
        [-99.2171,20.2206],[-99.21703,20.22096],[-99.21698,20.2212],[-99.21695,20.22134],
        [-99.21687,20.22232],[-99.21675,20.22303],[-99.21673,20.22316],[-99.21661,20.22382],
        [-99.21624,20.22562],[-99.21602,20.22683],[-99.21582,20.22775],[-99.21558,20.22877],
        [-99.21558,20.22877],[-99.21492,20.22893],[-99.21469,20.22902],[-99.21469,20.22902],
        [-99.21466,20.22927],[-99.21407,20.22919],[-99.21407,20.22919],[-99.21403,20.22946],
        [-99.21403,20.22946],[-99.21348,20.22941],[-99.21342,20.22941],[-99.21242,20.22929],
        [-99.21131,20.22914],[-99.21033,20.22903],[-99.21033,20.22903],[-99.21012,20.2302],
        [-99.21009,20.23038],[-99.20998,20.23099],[-99.20991,20.23142],[-99.20979,20.23212],
        [-99.2097,20.23264],[-99.20962,20.23308],[-99.20957,20.23337],[-99.20957,20.23337]
    ];

    let historyRoutePoints = [];
    const delay = 800; // Velocidad de la animación (ms)
    let currentLockState = false; // Estado inicial del bloqueo para la demo

    try {
        // Recorrer cada punto de la ruta
        for (let i = 0; i < geoJsonPath.length; i++) {
            const point = geoJsonPath[i];
            
            // IMPORTANTE: GeoJSON es [Lon, Lat], pero Firebase/Leaflet usan [Lat, Lon]
            const lat = point[1]; 
            const lon = point[0];

            // --- Generar datos simulados ---
            // Velocidad variable (más rápido en rectas)
            const speed = Math.floor(Math.random() * 40) + 20; 
            // Batería bajando
            const battery = Math.max(10, 100 - Math.floor((i / geoJsonPath.length) * 15)); 
            
            // Timestamp simulado (para que se vea bien en la gráfica)
            const now = new Date();
            // Restamos tiempo para que la ruta parezca haber ocurrido en la última hora
            now.setMinutes(now.getMinutes() - (geoJsonPath.length - i)); 
            const timestamp = now.toISOString();

            // --- EVENTOS ALEATORIOS ---
            
            // 1. Simular Inclinación (Caída)
            // Probabilidad del 5% en cada paso de tener una caída
            let tilt = Math.floor(Math.random() * 6) - 3; // Normal: -3 a 3
            let isFall = Math.random() < 0.05; 
            
            if (isFall) {
                tilt = Math.floor(Math.random() * 20) + 50; // Entre 50 y 70 grados
                console.log("🔥 ¡Evento aleatorio: CAÍDA!");
                showAlert(`¡Alerta! Caída detectada (${tilt}°)`, "error");
                
                // Guardar evento en Firebase
                const eventRef = doc(collection(db, "dispositivos", currentVehicleId, "events"));
                await setDoc(eventRef, {
                    tipo: "inclinacion",
                    valor: tilt,
                    mensaje: `Caída detectada (${tilt}°)`,
                    timestamp: timestamp
                });
            }

            // 2. Simular Bloqueo/Desbloqueo
            // Probabilidad del 5% de cambiar el estado
            let isLockEvent = Math.random() < 0.05;
            
            if (isLockEvent) {
                currentLockState = !currentLockState; // Invertir estado
                const msg = currentLockState ? "Motor BLOQUEADO remotamente" : "Motor DESBLOQUEADO";
                console.log(`🔒 ¡Evento aleatorio: ${msg}!`);
                showAlert(msg, currentLockState ? "error" : "success");

                // Guardar evento en Firebase
                const eventRef = doc(collection(db, "dispositivos", currentVehicleId, "events"));
                await setDoc(eventRef, {
                    tipo: "bloqueo",
                    activado: currentLockState,
                    mensaje: msg,
                    timestamp: timestamp
                });
            }


            // --- 1. ACTUALIZAR UI EN VIVO ---
            updateMapLocation(lat, lon);
            updateSpeed(speed);
            updateBattery(battery);
            updateModelTilt(tilt);
            updateSliderUI(tilt);
            
            // Actualizar icono de bloqueo en la UI
            const lockIcon = document.querySelector('#lockStatus i');
            if (currentLockState) {
                lockIcon.className = 'bi bi-lock-fill text-danger';
            } else {
                lockIcon.className = 'bi bi-unlock-fill text-success';
            }

            // Verificar geocercas
            checkGeofences(lat, lon, currentVehicleGeofences);

            // --- 2. GUARDAR PINGS (Para gráficas) ---
            const pingRef = doc(db, "dispositivos", currentVehicleId, "pings", timestamp.replace(/[:.]/g, "-"));
            await setDoc(pingRef, {
                bateria: battery,
                velocidad: speed,
                inclinacion: tilt,
                bloqueo: currentLockState,
                ubicacion: new GeoPoint(lat, lon),
                timestamp: timestamp
            });

            // --- 3. GUARDAR RUTA (Para mapa historial) ---
            // Guardamos un punto cada 3 pasos para no saturar, o si es un evento importante
            if (i === 0 || i === geoJsonPath.length - 1 || i % 3 === 0 || isFall || isLockEvent) {
                let pointName = `En ruta...`;
                if (isFall) pointName = `⚠️ Caída registrada`;
                else if (isLockEvent) pointName = currentLockState ? `🔒 Bloqueo` : `🔓 Desbloqueo`;

                historyRoutePoints.push({
                    name: pointName,
                    duration: "1 min", 
                    lat: lat,
                    lng: lon
                });
            }

            await sleep(delay);
        }

        // --- FINALIZAR: Guardar historial de ruta completa ---
        const todayId = getFormattedDate(new Date());
        const historyDocRef = doc(db, "dispositivos", currentVehicleId, "history_days", todayId);
        await setDoc(historyDocRef, {
            summary: { distance: "3.2 km (Demo)", maxSpeed: "62 km/h" },
            routePoints: historyRoutePoints
        });

        showAlert("Demo finalizada. Revisa la pestaña de Análisis.", "success");

    } catch (error) {
        console.error("Error en demo:", error);
        showAlert(`Error: ${error.message}`, "error");
    } finally {
        if (demoBtn) demoBtn.disabled = false;
    }
}
// --- (NUEVO) PASO 6: Funciones de Análisis y Gráficas ---

/**
 * Carga los datos de 'pings' y 'events' y renderiza el dashboard de análisis.
 */
/**
 * (MODIFICADO) Carga Pings, Eventos y Historial Diario para calcular los 4 KPIs.
 */
async function loadAnalysisData(vehicleId) {
    const container = document.getElementById('history-analysis-pane');
    if (!container) return;

    // Mostrar spinner de carga
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2">Calculando KPIs...</p></div>';

    try {
        // 1. Pings (Últimos 100 para mayor precisión en geocercas y batería)
        const pingsQuery = query(
            collection(db, "dispositivos", vehicleId, "pings"),
            orderBy("timestamp", "desc"),
            limit(100)
        );
        
        // 2. Eventos (Últimos 50 para seguridad)
        const eventsQuery = query(
            collection(db, "dispositivos", vehicleId, "events"),
            orderBy("timestamp", "desc"),
            limit(50)
        );

        // 3. Historial de Días (Últimos 7 días para eficiencia)
        const historyQuery = query(
            collection(db, "dispositivos", vehicleId, "history_days"),
            limit(7) // Solo la última semana
        );

        const [pingsSnap, eventsSnap, historySnap] = await Promise.all([
            getDocs(pingsQuery),
            getDocs(eventsQuery),
            getDocs(historyQuery)
        ]);

        // Procesar datos
        const pingsData = pingsSnap.docs.map(d => d.data()).reverse(); // Orden cronológico
        const eventsData = eventsSnap.docs.map(d => d.data());
        const historyData = historySnap.docs.map(d => d.data());

        // Renderizar UI con los 4 KPIs
        renderAnalysisUI(container, pingsData, eventsData, historyData);

    } catch (error) {
        console.error("Error cargando análisis:", error);
        container.innerHTML = `<div class="alert alert-danger m-3">Error al cargar datos: ${error.message}</div>`;
    }
}

/**
 * (MODIFICADO) Renderiza los 4 KPIs y las gráficas.
 */
function renderAnalysisUI(container, pings, events, historyDays) {
    
    // 1. Calcular los valores
    const kpiSafety = calculateSafetyKPI(events);
    const kpiGeo = calculateGeofenceKPI(pings);
    const kpiDist = calculateEfficiencyKPI(historyDays);
    const kpiBat = calculateBatteryHealthKPI(pings);

    // 2. Construir HTML
    container.innerHTML = `
        <div class="row g-3 mb-4">
            
            <div class="col-md-3 col-6">
                <div class="card h-100 border-${kpiSafety.status} shadow-sm">
                    <div class="card-body text-center p-2">
                        <small class="text-muted fw-bold">SEGURIDAD</small>
                        <h3 class="display-6 fw-bold text-${kpiSafety.status} my-2">${kpiSafety.value}</h3>
                        <div class="badge bg-${kpiSafety.status} bg-opacity-10 text-${kpiSafety.status}">
                            ${kpiSafety.text}
                        </div>
                        <div class="small text-muted mt-1">Caídas detectadas</div>
                    </div>
                </div>
            </div>

            <div class="col-md-3 col-6">
                <div class="card h-100 border-${kpiGeo.status} shadow-sm">
                    <div class="card-body text-center p-2">
                        <small class="text-muted fw-bold">CONTROL</small>
                        <h3 class="display-6 fw-bold text-${kpiGeo.status} my-2">${kpiGeo.value}</h3>
                        <div class="badge bg-${kpiGeo.status} bg-opacity-10 text-${kpiGeo.status}">
                            ${kpiGeo.text}
                        </div>
                        <div class="small text-muted mt-1">Tiempo en zona</div>
                    </div>
                </div>
            </div>

            <div class="col-md-3 col-6">
                <div class="card h-100 border-primary shadow-sm">
                    <div class="card-body text-center p-2">
                        <small class="text-muted fw-bold">USO</small>
                        <h3 class="display-6 fw-bold text-primary my-2">${kpiDist.value}</h3>
                        <div class="badge bg-primary bg-opacity-10 text-primary">
                            ${kpiDist.text}
                        </div>
                        <div class="small text-muted mt-1">Distancia recorrida</div>
                    </div>
                </div>
            </div>

            <div class="col-md-3 col-6">
                <div class="card h-100 border-${kpiBat.status} shadow-sm">
                    <div class="card-body text-center p-2">
                        <small class="text-muted fw-bold">BATERÍA</small>
                        <h3 class="display-6 fw-bold text-${kpiBat.status} my-2">${kpiBat.value}</h3>
                        <div class="badge bg-${kpiBat.status} bg-opacity-10 text-${kpiBat.status}">
                            ${kpiBat.text}
                        </div>
                        <div class="small text-muted mt-1">Carga mínima</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row g-4">
            <div class="col-lg-8">
                <div class="card h-100 shadow-sm">
                    <div class="card-header bg-white py-3">
                        <h6 class="card-title mb-0"><i class="bi bi-graph-down"></i> Tendencia de Batería (Últimas Horas)</h6>
                    </div>
                    <div class="card-body">
                        <div style="height: 250px;">
                            <canvas id="batteryChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="card h-100 shadow-sm">
                    <div class="card-header bg-white py-3">
                        <h6 class="mb-0"><i class="bi bi-clock-history"></i> Eventos Recientes</h6>
                    </div>
                    <ul class="list-group list-group-flush" style="max-height: 280px; overflow-y: auto;">
                        ${events.length === 0 ? '<li class="list-group-item text-muted text-center py-4">Sin eventos recientes.</li>' : ''}
                        ${events.map(e => {
                            const date = new Date(e.timestamp);
                            const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                            const dateStr = date.toLocaleDateString();
                            
                            let icon = 'bi-info-circle text-secondary';
                            let bgClass = '';
                            
                            if (e.tipo === 'inclinacion') {
                                icon = 'bi-exclamation-triangle-fill text-danger';
                                bgClass = 'bg-danger bg-opacity-10';
                            } else if (e.tipo === 'bloqueo') {
                                icon = e.activado ? 'bi-lock-fill text-danger' : 'bi-unlock-fill text-success';
                            }

                            return `
                                <li class="list-group-item d-flex align-items-start ${bgClass}">
                                    <div class="me-3 mt-1"><i class="bi ${icon} fs-5"></i></div>
                                    <div>
                                        <div class="fw-bold small">${e.mensaje || 'Evento detectado'}</div>
                                        <div class="text-muted" style="font-size: 0.75rem;">${dateStr} - ${timeStr}</div>
                                    </div>
                                </li>
                            `;
                        }).join('')}
                    </ul>
                </div>
            </div>
        </div>
    `;

    // 3. Dibujar la gráfica (La función drawBatteryChart ya la tienes, no cambia)
    drawBatteryChart(pings);
}

/**
 * Dibuja la gráfica de línea usando Chart.js
 */
function drawBatteryChart(pings) {
    const ctx = document.getElementById('batteryChart');
    if (!ctx) return;

    // Preparar datos
    const labels = pings.map(p => {
        const date = new Date(p.timestamp);
        return `${date.getHours()}:${date.getMinutes() < 10 ? '0' : ''}${date.getMinutes()}`;
    });
    const dataPoints = pings.map(p => p.bateria);

    // Crear Chart
    batteryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Nivel de Batería (%)',
                data: dataPoints,
                borderColor: '#10b981', // Verde RiderSafe
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4, // Curvas suaves
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    min: 0,
                    max: 100
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// --- Desbloqueo de Audio ---
// Escucha el primer clic en cualquier parte del documento para habilitar el audio
document.addEventListener('click', function unlockAudio() {
    // Intentar reproducir y pausar inmediatamente
    notificationSound.play().then(() => {
        notificationSound.pause();
        notificationSound.currentTime = 0;
    }).catch(() => {});

    // Remover este listener para que no se ejecute en cada clic
    document.removeEventListener('click', unlockAudio);
}, { once: true });

// --- FUNCIONES DE CÁLCULO DE KPIs ---

/** KPI 1: Seguridad (Eventos de Inclinación) */
function calculateSafetyKPI(events) {
    // Contar eventos de tipo 'inclinacion'
    const falls = events.filter(e => e.tipo === 'inclinacion').length;
    // Determinar estado (0 es excelente, >0 es alerta)
    const status = falls === 0 ? 'success' : 'danger';
    const text = falls === 0 ? 'Seguro' : 'Riesgo';
    return { value: falls, status: status, text: text };
}

/** KPI 2: Adherencia a Geocercas (% de tiempo dentro) */
function calculateGeofenceKPI(pings) {
    if (pings.length === 0 || currentVehicleGeofences.length === 0) {
        return { value: 0, status: 'secondary', text: 'Sin datos' };
    }

    let pointsInside = 0;
    
    pings.forEach(ping => {
        // Verificar si este punto está dentro de ALGUNA de las geocercas activas
        let isInsideAny = false;
        if (ping.ubicacion) { // Asegurarse que el ping tenga lat/lon
            // Usamos currentVehicleGeofences (variable global)
            for (const fence of currentVehicleGeofences) {
                const dist = getDistance(ping.ubicacion.latitude, ping.ubicacion.longitude, fence.lat, fence.lon);
                if (dist <= fence.radius) {
                    isInsideAny = true;
                    break; 
                }
            }
        }
        if (isInsideAny) pointsInside++;
    });

    const percentage = Math.round((pointsInside / pings.length) * 100);
    
    // Semáforo: >80% Verde, 50-80% Amarillo, <50% Rojo
    let status = 'danger';
    if (percentage >= 80) status = 'success';
    else if (percentage >= 50) status = 'warning';

    return { value: `${percentage}%`, status: status, text: 'En Zona Segura' };
}

/** KPI 3: Eficiencia (Distancia Total 7 días) */
function calculateEfficiencyKPI(historyDays) {
    let totalKm = 0;
    
    historyDays.forEach(day => {
        if (day.summary && day.summary.distance) {
            // El string suele ser "12.5 km". Extraemos el número.
            const distString = day.summary.distance; 
            const distNumber = parseFloat(distString.split(' ')[0]);
            if (!isNaN(distNumber)) totalKm += distNumber;
        }
    });

    // Redondear a 1 decimal
    totalKm = Math.round(totalKm * 10) / 10;
    
    return { value: `${totalKm} km`, status: 'primary', text: 'Últimos 7 días' };
}

/** KPI 4: Salud de Batería (Nivel Mínimo Reciente) */
function calculateBatteryHealthKPI(pings) {
    if (pings.length === 0) return { value: '--', status: 'secondary' };
    
    // Encontrar el valor mínimo de batería en los pings recientes
    let minBat = 100;
    pings.forEach(p => {
        if (p.bateria < minBat) minBat = p.bateria;
    });

    let status = 'success';
    if (minBat < 20) status = 'danger';
    else if (minBat < 50) status = 'warning';

    return { value: `${minBat}%`, status: status, text: 'Nivel Mínimo' };
}

export { initDashboard };
