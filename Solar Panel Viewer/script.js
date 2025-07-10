
// =====================================================
// Solar Panel Viewer - Main Script
//
// This script implements the interactive 3D solar panel viewer web app.
// It handles model loading, UI controls, drag-and-drop, lighting, axes helper,
// coordinate editing, shadow coverage, and export functionality.
//
// Key dependencies: Three.js, @tweenjs/tween.js, suncalc
//
// =====================================================

// === Imports ===
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import TWEEN from '@tweenjs/tween.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import SunCalc from 'suncalc';

// === Globals (Three.js Core) ===
let scene, camera, renderer, model, controls;
let modelContainer, baseModelContainer;
let modelBoundingBox, cameraDistance;

// === Lighting ===
let directionalLight, lightPivot;

// === UI Elements ===
let lightControlsContainer, toggleSunControlsButton, sunControlsContent;
let latitudeInput, longitudeInput, dateInput, timeSlider, timeInput, timezoneOffsetInput;
let coordPopup, coordXInput, coordYInput, coordZInput;
let shadowCoveragePopup, shadowCoverageText;
let deleteObjectButton, addPanelButton, exportButton;

// === State Variables ===
let initialViewPositions = {};
let isDragging = false;
let pointerDownOnDraggable = false;
let draggableObjects = new Set();
let intersectedObject = null;
const localPivotToBBoxCenterOffsets = new Map();
let rotationAngle = Math.PI / 9; // 20 degrees

// === Raycasting/Dragging ===
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane();
let _dragOffset = new THREE.Vector3();
let originalMaterials = new Map();

// === Materials ===
const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    wireframe: false,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    castShadow: true,
    receiveShadow: true
});

const standardMaterial = new THREE.MeshStandardMaterial({
    color: 0xbd9953,
    roughness: 0.8,
    metalness: 0
});

const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x543ae8,
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.DoubleSide
});

// === Constants ===
const VOLUME_EPSILON = 1e-9;
const MIN_SURFACE_AREA_TO_VOLUME_RATIO = 0.008;
const MAX_VOLUME = 5000000000;
const DRAGGABLE_MIN_DIMENSION = 0.1;
const DRAGGABLE_MAX_DIMENSION = 1.2;

// === Loading Screen ===
const loadingScreen = document.getElementById('loading-screen');
const progressText = document.querySelector('#loading-screen .progress-text');

// === Axes Helper ===
let axesScene, axesCamera, customAxes;
let xAxisLine, yAxisLine, zAxisLine;
let originalXMaterial, originalYMaterial, originalZMaterial;
const axesCameraSize = 225;
const axesPadding = 20;
let currentHoveredAxisPreviewTween = null;
let customAxesRotation = new THREE.Quaternion();

// === Converting 3D mesh objects to 2D planes ===
function calculatePolygonArea(vertices) {
    if (vertices.length < 3) {
        return 0;
    }

    const normal = new THREE.Vector3();
    if (vertices.length >= 3) { // Finding normal vector
        const v1 = new THREE.Vector3().subVectors(vertices[1], vertices[0]);
        const v2 = new THREE.Vector3().subVectors(vertices[2], vertices[0]);
        normal.crossVectors(v1, v2).normalize();
    } else {
        return 0;
    }

    const absNormalX = Math.abs(normal.x);
    const absNormalY = Math.abs(normal.y);
    const absNormalZ = Math.abs(normal.z);

    let projectedVertices = [];
    if (absNormalX >= absNormalY && absNormalX >= absNormalZ) { // Project to YZ plane
        projectedVertices = vertices.map(v => new THREE.Vector2(v.y, v.z));
    } else if (absNormalY >= absNormalX && absNormalY >= absNormalZ) { // Project to XZ plane
        projectedVertices = vertices.map(v => new THREE.Vector2(v.x, v.z));
    } else { // Project to XY plane
        projectedVertices = vertices.map(v => new THREE.Vector2(v.x, v.y));
    }

    let projectedArea = 0;
    for (let i = 0; i < projectedVertices.length; i++) {
        const p1 = projectedVertices[i];
        const p2 = projectedVertices[(i + 1) % projectedVertices.length];
        projectedArea += (p1.x * p2.y - p1.y * p2.x);
    }
    projectedArea = Math.abs(projectedArea) / 2;

    let scaleFactor = 1.0;
    if (absNormalX >= absNormalY && absNormalX >= absNormalZ) {
        scaleFactor = 1.0 / absNormalX;
    } else if (absNormalY >= absNormalX && absNormalY >= absNormalZ) {
        scaleFactor = 1.0 / absNormalY;
    } else {
        scaleFactor = 1.0 / absNormalZ;
    }

    if (isNaN(scaleFactor) || !isFinite(scaleFactor)) {
        return projectedArea;
    }

    return projectedArea * scaleFactor;
}

// Function to find coplanar faces and their areas
function getFacesWithAreas(object) {
    const faces = [];
    if (!object || !object.isMesh || !object.geometry) {
        return faces;
    }

    const positionAttribute = object.geometry.getAttribute('position');
    const indexAttribute = object.geometry.getIndex();

    if (!positionAttribute) {
        return faces;
    }

    const triangles = [];
    if (indexAttribute) {
        for (let i = 0; i < indexAttribute.count; i += 3) {
            const idxA = indexAttribute.getX(i);
            const idxB = indexAttribute.getX(i + 1);
            const idxC = indexAttribute.getX(i + 2);

            const vA = new THREE.Vector3().fromBufferAttribute(positionAttribute, idxA).applyMatrix4(object.matrixWorld);
            const vB = new THREE.Vector3().fromBufferAttribute(positionAttribute, idxB).applyMatrix4(object.matrixWorld);
            const vC = new THREE.Vector3().fromBufferAttribute(positionAttribute, idxC).applyMatrix4(object.matrixWorld);

            const triangleNormal = new THREE.Triangle(vA, vB, vC).getNormal(new THREE.Vector3());
            triangles.push({ vertices: [vA, vB, vC], normal: triangleNormal, originalIndices: [idxA, idxB, idxC], faceIndex: Math.floor(i / 3) });
        }
    } else {
        for (let i = 0; i < positionAttribute.count; i += 3) {
            const vA = new THREE.Vector3().fromBufferAttribute(positionAttribute, i).applyMatrix4(object.matrixWorld);
            const vB = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 1).applyMatrix4(object.matrixWorld);
            const vC = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 2).applyMatrix4(object.matrixWorld);

            const triangleNormal = new THREE.Triangle(vA, vB, vC).getNormal(new THREE.Vector3());
            triangles.push({ vertices: [vA, vB, vC], normal: triangleNormal, faceIndex: Math.floor(i / 3) });
        }
    }

    const coplanarTolerance = 0.01; // Tolerance for normal comparison and point-to-plane distance

    const groupedFaces = [];
    const usedTriangles = new Set();

    for (let i = 0; i < triangles.length; i++) {
        if (usedTriangles.has(i)) continue;

        const currentTriangle = triangles[i];
        const currentNormal = currentTriangle.normal;
        const currentVertices = currentTriangle.vertices;

        const plane = new THREE.Plane().setFromCoplanarPoints(currentVertices[0], currentVertices[1], currentVertices[2]);
        const currentFaceTriangles = [currentTriangle];
        usedTriangles.add(i);

        for (let j = i + 1; j < triangles.length; j++) {
            if (usedTriangles.has(j)) continue;

            const otherTriangle = triangles[j];
            const otherNormal = otherTriangle.normal;
            const otherVertices = otherTriangle.vertices;

            if (currentNormal.dot(otherNormal) > (1 - coplanarTolerance)) {
                let allPointsCoplanar = true;
                for (const v of otherVertices) {
                    if (Math.abs(plane.distanceToPoint(v)) > coplanarTolerance) {
                        allPointsCoplanar = false;
                        break;
                    }
                }

                if (allPointsCoplanar) {
                    currentFaceTriangles.push(otherTriangle);
                    usedTriangles.add(j);
                }
            }
        }

        const faceVerticesMap = new Map();
        currentFaceTriangles.forEach(tri => {
            tri.vertices.forEach(v => {
                const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
                faceVerticesMap.set(key, v);
            });
        });

        let uniqueVertices = Array.from(faceVerticesMap.values());

        if (uniqueVertices.length > 2) {
            const centroid = new THREE.Vector3();
            uniqueVertices.forEach(v => centroid.add(v));
            centroid.divideScalar(uniqueVertices.length);

            const basisX = new THREE.Vector3();
            const basisY = new THREE.Vector3();

            if (Math.abs(currentNormal.x) < 0.9 && Math.abs(currentNormal.y) < 0.9) {
                basisX.set(1, 0, 0).projectOnPlane(currentNormal).normalize();
            } else {
                basisX.set(0, 1, 0).projectOnPlane(currentNormal).normalize();
            }
            basisY.crossVectors(currentNormal, basisX).normalize();

            uniqueVertices.sort((a, b) => {
                const vecA = new THREE.Vector3().subVectors(a, centroid);
                const vecB = new THREE.Vector3().subVectors(b, centroid);

                const projA_x = vecA.dot(basisX);
                const projA_y = vecA.dot(basisY);
                const angleA = Math.atan2(projA_y, projA_x);

                const projB_x = vecB.dot(basisX);
                const projB_y = vecB.dot(basisY);
                const angleB = Math.atan2(projB_y, projB_x);

                return angleA - angleB;
            });
        }

        const faceArea = calculatePolygonArea(uniqueVertices);
        if (faceArea > 0) {
            faces.push({
                vertices: uniqueVertices,
                normal: currentNormal,
                area: faceArea
            });
        }
    }

    faces.sort((a, b) => b.area - a.area);
    return faces;
}

// Function to convert draggable objects to their largest 2D faces
function convertDraggableObjectsToLargestPanels() {
    scene.updateMatrixWorld(true);

    const objectsToConvert = Array.from(draggableObjects);
    const newDraggablePanels = new Set();

    objectsToConvert.forEach(object => {
        const objectBoundingBox = new THREE.Box3().setFromObject(object, true);
        const objectWorldCenter = objectBoundingBox.getCenter(new THREE.Vector3());
        if (!object.isMesh || !object.geometry) {
            console.warn("Skipping non-mesh or mesh without geometry in draggableObjects:", object.name || object.uuid);
            newDraggablePanels.add(object);
            return;
        }

        console.log(`Processing object for panel conversion: ${object.name || object.uuid}`);
        const originalWorldPosition = new THREE.Vector3();
        object.getWorldPosition(originalWorldPosition);
        console.log(`Original object ${object.name || object.uuid} world position: [${originalWorldPosition.x.toFixed(2)}, ${originalWorldPosition.y.toFixed(2)}, ${originalWorldPosition.z.toFixed(2)}]`);

        const facesWithAreas = getFacesWithAreas(object);

        if (facesWithAreas.length === 0 || facesWithAreas[0].vertices.length < 3) {
            console.warn("Could not find a suitable large face on object for panel creation:", object.name || object.uuid);
            newDraggablePanels.add(object);
            return;
        }

        const largestFace = facesWithAreas[0];

        // Calculate the centroid of the largest face in world coordinates
        const centroid = new THREE.Vector3();
        largestFace.vertices.forEach(v => centroid.add(v));
        centroid.divideScalar(largestFace.vertices.length);

        console.log(`Calculated panel centroid: [${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)}, ${centroid.z.toFixed(2)}]`);

        const panelGeometry = new THREE.BufferGeometry();
        const positions = [];
        const normals = [];
        const uvs = [];

        const faceNormal = largestFace.normal;

        const translatedVertices = largestFace.vertices.map(v => new THREE.Vector3().subVectors(v, centroid));

        const anchorVertexLocal = translatedVertices[0];

        for (let i = 1; i < translatedVertices.length - 1; i++) {
            const v1 = translatedVertices[i];
            const v2 = translatedVertices[i + 1];

            positions.push(anchorVertexLocal.x, anchorVertexLocal.y, anchorVertexLocal.z);
            positions.push(v1.x, v1.y, v1.z);
            positions.push(v2.x, v2.y, v2.z);

            for (let k = 0; k < 3; k++) {
                normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
                uvs.push(0, 0);
            }
        }

        panelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        panelGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        panelGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.name = `Panel_${object.name || object.uuid}`;
        panel.castShadow = true;
        panel.receiveShadow = true;
        panel.userData.is2DPanel = true;

        const newPanelLocalPosition = new THREE.Vector3().copy(objectWorldCenter);
        modelContainer.worldToLocal(newPanelLocalPosition);
        panel.position.copy(newPanelLocalPosition);
        modelContainer.add(panel);
        newDraggablePanels.add(panel);

        // Dispose of original object's resources
        if (object.parent) {
            object.parent.remove(object);
            object.geometry.dispose();
            if (object.material && !Array.isArray(object.material)) {
                object.material.dispose();
            } else if (Array.isArray(object.material)) {
                object.material.forEach(mat => mat.dispose());
            }
        }
        console.log(`Replaced ${object.name || object.uuid} with panel: ${panel.name} at world position: [${panel.position.x.toFixed(2)}, ${panel.position.y.toFixed(2)}, ${panel.position.z.toFixed(2)}]`);
    });

    draggableObjects.clear();
    newDraggablePanels.forEach(panel => draggableObjects.add(panel));
    console.log("All draggable objects converted to 2D panels.");
}

// === Shadow Coverage Calculation ===
function calculateShadowCoverage(object) {
    if (!object || !object.isMesh || !object.geometry) {
        console.warn("Invalid object for shadow coverage calculation.");
        return 0;
    }

    const totalSamples = 1000; // Number of points to sample on the object's surface
    let shadowedSamples = 0;

    const positionAttribute = object.geometry.getAttribute('position');
    if (!positionAttribute) {
        return 0;
    }

    const raycasterForShadow = new THREE.Raycaster();
    const lightDirection = new THREE.Vector3().subVectors(directionalLight.target.position, directionalLight.position).normalize();
    const index = object.geometry.getIndex();
    const faceCount = index ? index.count / 3 : positionAttribute.count / 3;

    for (let i = 0; i < totalSamples; i++) {
        // Randomly pick a face
        const faceIndex = Math.floor(Math.random() * faceCount);
        const a = index ? index.getX(faceIndex * 3) : faceIndex * 3;
        const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
        const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;

        const vA = new THREE.Vector3().fromBufferAttribute(positionAttribute, a);
        const vB = new THREE.Vector3().fromBufferAttribute(positionAttribute, b);
        const vC = new THREE.Vector3().fromBufferAttribute(positionAttribute, c);

        // Transform vertices to world coordinates
        vA.applyMatrix4(object.matrixWorld);
        vB.applyMatrix4(object.matrixWorld);
        vC.applyMatrix4(object.matrixWorld);

        let r1 = Math.random();
        let r2 = Math.random();
        if (r1 + r2 > 1) { // Ensure point stays within the triangle
            r1 = 1 - r1;
            r2 = 1 - r2;
        }

        // Calculate point on triangle using barycentric coordinates
        const pointOnTriangle = new THREE.Vector3()
            .copy(vA)
            .multiplyScalar(1 - r1 - r2)
            .add(vB.clone().multiplyScalar(r1))
            .add(vC.clone().multiplyScalar(r2));

        const rayOrigin = pointOnTriangle.clone().add(lightDirection.clone().negate().multiplyScalar(0.005)); // 0.005
        raycasterForShadow.set(rayOrigin, lightDirection.clone().negate()); // Ray points from slightly offset point to light

        // Cast ray and check for intersections
        // Exclude the object itself from being intersected to avoid self-shadowing issues
        const intersects = raycasterForShadow.intersectObjects(scene.children.filter(child => child !== object && child !== directionalLight), true);

        let isInShadow = false;
        for (let j = 0; j < intersects.length; j++) {
            const intersect = intersects[j];

            if (intersect.object.castShadow) {
                isInShadow = true;
                break;
            }
        }

        if (isInShadow) {
            shadowedSamples++;
        }
    }

    const coveragePercentage = (shadowedSamples / totalSamples) * 100;
    return coveragePercentage.toFixed(1);
}

// === Website Initialization ===
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 500);
    camera.updateProjectionMatrix();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    coordPopup = document.getElementById('coordinate-popup');
    coordXInput = document.getElementById('coord-x');
    coordYInput = document.getElementById('coord-y');
    coordZInput = document.getElementById('coord-z');

    coordXInput.addEventListener('change', onCoordInputChange);
    coordYInput.addEventListener('change', onCoordInputChange);
    coordZInput.addEventListener('change', onCoordInputChange);

    shadowCoveragePopup = document.getElementById('shadow-coverage-popup');
    shadowCoverageText = document.getElementById('shadow-coverage-text');

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;

    const ambientLight = new THREE.AmbientLight(0xedebeb, 1.5);
    scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 1);
    scene.add(hemisphereLight);

    lightPivot = new THREE.Object3D();
    lightPivot.position.set(0,0,0);
    scene.add(lightPivot);

    directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.castShadow = true;
    directionalLight.shadow.intensity = 1;
    directionalLight.shadow.bias = -0.005;

    // Shadow map settings for directional light
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;

    // Orthographic camera for directional light's shadow frustum
    directionalLight.shadow.camera.left = -20;
    directionalLight.shadow.camera.right = 20;
    directionalLight.shadow.camera.top = 20;
    directionalLight.shadow.camera.bottom = -20;

    lightPivot.add(directionalLight);
    scene.add(directionalLight.target);
    const directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 1);

    lightControlsContainer = document.getElementById('light-controls-container');
    toggleSunControlsButton = document.getElementById('toggle-sun-controls');
    sunControlsContent = document.getElementById('sun-controls-content');

    latitudeInput = document.getElementById('latitude-input');
    longitudeInput = document.getElementById('longitude-input');
    dateInput = document.getElementById('date-input');
    timezoneOffsetInput = document.getElementById('timezone-offset-input');

    timeSlider = document.getElementById('time-slider');
    timeInput = document.getElementById('time-input');
    
    const today = new Date();
    dateInput.valueAsDate = today;

    const currentHour = today.getHours();
    const currentMinute = today.getMinutes();
    const initialTimeDecimal = currentHour + currentMinute / 60; // set as 12.0 if you want noon
    timeSlider.value = initialTimeDecimal.toFixed(2);
    updateTimeDisplay(initialTimeDecimal);

    // Pull-out tab event listeners
    toggleSunControlsButton.addEventListener('click', () => {
        const isExpanded = lightControlsContainer.classList.toggle('expanded');
        if (isExpanded) {
            toggleSunControlsButton.querySelector('.arrow').classList.remove('left-arrow');
            toggleSunControlsButton.querySelector('.arrow').classList.add('right-arrow');
            sunControlsContent.style.opacity = '1';
            sunControlsContent.style.pointerEvents = 'auto';
        scene.add(directionalLightHelper);
        directionalLightHelper.update();
        } else {
            toggleSunControlsButton.querySelector('.arrow').classList.remove('right-arrow');
            toggleSunControlsButton.querySelector('.arrow').classList.add('left-arrow');
            sunControlsContent.style.opacity = '0';
            sunControlsContent.style.pointerEvents = 'none';
        scene.remove(directionalLightHelper);
        }
    });

    // Sun position inputs event listeners
    latitudeInput.addEventListener('change', updateSunPosition);
    longitudeInput.addEventListener('change', updateSunPosition);
    dateInput.addEventListener('change', updateSunPosition);
    timeSlider.addEventListener('input', () => {
        const decimalHours = parseFloat(timeSlider.value);
        updateTimeDisplay(decimalHours);
        updateSunPosition();
    });
    timezoneOffsetInput.addEventListener('change', updateSunPosition);

    timeInput.addEventListener('change', () => {
        const timeString = timeInput.value;
        const [hoursStr, minutesStr] = timeString.split(':');
        const hours = parseInt(hoursStr, 10);
        const minutes = parseInt(minutesStr, 10);

        // Validate parsed time components
        if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            const decimalHours = hours + minutes / 60;
            timeSlider.value = decimalHours;
            updateSunPosition(); // Recalculate sun position based on new time
        } else {
            console.warn("Invalid time input. Please use HH:MM format (e.g., 14:30).");
            updateTimeDisplay(parseFloat(timeSlider.value));
        }
    });
    
    updateSunPosition(); // Call this once to set initial light position based on default values


    // Function to update the time display span based on slider value
    function updateTimeDisplay(decimalHours) {
        const hours = Math.floor(decimalHours);
        const minutes = Math.round((decimalHours - hours) * 60);

        const formattedHours = String(hours).padStart(2, '0');
        const formattedMinutes = String(minutes).padStart(2, '0');

        const displayString = `${formattedHours}:${formattedMinutes}`;

        // Update the timeInput field's value
        if (timeInput) {
            timeInput.value = displayString;
    	}
    }

    
    function updateSunPosition() {
    	const latitude = parseFloat(latitudeInput.value);
    	const longitude = parseFloat(longitudeInput.value);
    	const date = new Date(dateInput.value);
    	const timeInHours = parseFloat(timeSlider.value);
    	const timezoneOffsetHours = parseFloat(timezoneOffsetInput.value);

    	const finalDateForSunCalc = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            Math.floor(timeInHours), // Hours
            Math.round((timeInHours - Math.floor(timeInHours)) * 60), // Minutes
            0 // Seconds
    	);

    	finalDateForSunCalc.setUTCHours(finalDateForSunCalc.getHours() - timezoneOffsetHours);

    	const sunPos = SunCalc.getPosition(finalDateForSunCalc, latitude, longitude);

    	const distance = 100;

    	// Calculate components based on SunCalc output
    	const horizontal_distance_from_origin = distance * Math.cos(sunPos.altitude);

    	// adjustedAzimuth: SunCalc azimuth (clockwise from South) adjusted to be clockwise from North
    	const adjustedAzimuth = sunPos.azimuth + Math.PI;

    	// Assignments for coordinate system:
    	const sunX_east = horizontal_distance_from_origin * Math.sin(adjustedAzimuth); // X-axis (East/West)
    	const sunY_north = horizontal_distance_from_origin * Math.cos(adjustedAzimuth); // Y-axis (North/South)
    	const sunZ_up = distance * Math.sin(sunPos.altitude); // Z-axis (Up/Down)

    	directionalLight.position.set(sunX_east, sunY_north, sunZ_up);

    	// Light points towards center
    	const center = new THREE.Vector3();
    	if (modelBoundingBox && !modelBoundingBox.isEmpty()) {
            modelBoundingBox.getCenter(center);
    	} else {
            center.set(0, 0, 0); // Origin is default
     	}

    	directionalLight.target.position.copy(center);
    	directionalLight.target.updateMatrixWorld();
    	directionalLightHelper.update();

    	console.log("Directional Light Y position after set:", directionalLight.position.y);
    	directionalLight.target.updateMatrixWorld(); 

    	// Update shadow camera frustum based on model bounding box
    	if (modelBoundingBox && !modelBoundingBox.isEmpty()) {
            const size = new THREE.Vector3();
            modelBoundingBox.getSize(size);
            const center = new THREE.Vector3();
            modelBoundingBox.getCenter(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            const frustumSize = maxDim * 1.5;

            const lightCamera = directionalLight.shadow.camera;
            lightCamera.left = -frustumSize / 2;
            lightCamera.right = frustumSize / 2;
            lightCamera.top = frustumSize / 2;
            lightCamera.bottom = -frustumSize / 2;

            const lightToTargetDistance = directionalLight.position.distanceTo(center);
            lightCamera.near = lightToTargetDistance - frustumSize * 0.75;
            lightCamera.far = lightToTargetDistance + frustumSize * 0.75;
            if (lightCamera.near < 0.1) lightCamera.near = 0.1;

            directionalLight.target.position.copy(center);
            directionalLight.target.updateMatrixWorld();

            lightCamera.updateProjectionMatrix();  
    	}

	    if (intersectedObject && draggableObjects.has(intersectedObject)) {
            const shadowCoverage = calculateShadowCoverage(intersectedObject);
            showShadowCoveragePopup(intersectedObject, shadowCoverage);
        }
    }

    const manager = new THREE.LoadingManager();

    manager.onStart = function () {
        loadingScreen.style.display = 'flex';
        progressText.textContent = '0%';
    };

    manager.onProgress = function (url, itemsLoaded, itemsTotal) {
        const percentage = Math.round((itemsLoaded / itemsTotal) * 100);
        progressText.textContent = `${percentage}%`;
    };

    manager.onLoad = function () {
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    };

    manager.onError = function (url) {
        console.error('Error loading model:', url);
        progressText.textContent = 'Error!';
    };

    axesScene = new THREE.Scene();
    axesScene.background = new THREE.Color(0xb19976);
    axesCamera = new THREE.OrthographicCamera(
        -axesCameraSize / 2, axesCameraSize / 2,
        axesCameraSize / 2, -axesCameraSize / 2,
        1, 1000
    );
    axesCamera.position.set(0, 0, 50);

    customAxes = new THREE.Group();

    xAxisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(80, 0, 0)]),
        new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 })
    );
    originalXMaterial = xAxisLine.material.clone();
    customAxes.add(xAxisLine);

    yAxisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 80, 0)]),
        new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 })
    );
    originalYMaterial = yAxisLine.material.clone();
    customAxes.add(yAxisLine);

    zAxisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 80)]),
        new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 })
    );
    originalZMaterial = zAxisLine.material.clone();
    customAxes.add(zAxisLine);

    // Add X, Y, Z labels to the axes helper
    const xLabel = createTextSprite('X', '#FF0000');
    xLabel.position.set(90, 0, 0);
    customAxes.add(xLabel);

    const yLabel = createTextSprite('Y', '#00FF00');
    yLabel.position.set(0, 90, 0);
    customAxes.add(yLabel);

    const zLabel = createTextSprite('Z', '#0000FF');
    zLabel.position.set(0, 0, 90);
    customAxes.add(zLabel);

    axesScene.add(customAxes);

    const originBoxGeometry = new THREE.BoxGeometry(30, 30, 30);
    const originBoxMaterial = new THREE.MeshBasicMaterial({ color: 0xff8000 });
    const originBox = new THREE.Mesh(originBoxGeometry, originBoxMaterial);
    customAxes.add(originBox); // Orange box at the helper axes origin

    const originBoxEdges = new THREE.EdgesGeometry(originBoxGeometry);
    const originBoxLineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
    const originBoxLines = new THREE.LineSegments(originBoxEdges, originBoxLineMaterial);
    customAxes.add(originBoxLines);

    const axesAmbientLight = new THREE.AmbientLight(0xffffff, 0.5);
    axesScene.add(axesAmbientLight);

    const loader = new GLTFLoader(manager);
    loader.load(
        'output.glb',
        function (gltf) {
            model = gltf.scene;

            baseModelContainer = new THREE.Group();
            scene.add(baseModelContainer);

            modelContainer = new THREE.Group();
            baseModelContainer.add(modelContainer);

            modelContainer.add(model);

            const meshesToProcess = [];
            model.traverse((child) => {
                if (child.isMesh) {
                    meshesToProcess.push(child);
                }
            });

            meshesToProcess.forEach(mesh => {
                if (mesh.userData.is2DPanel) {
                    console.log(`Skipping volume/ratio filter for 2D Panel: ${mesh.name || mesh.uuid}`);
                    mesh.material = panelMaterial;
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    if (mesh.geometry && mesh.geometry.isBufferGeometry) {
                        mesh.geometry.computeVertexNormals();
                    }

                    return; // Skip filtering logic
                }

                if (!mesh.geometry.boundingBox) {
                    mesh.geometry.computeBoundingBox();
                }
                const box = mesh.geometry.boundingBox;
                const size = new THREE.Vector3();
                box.getSize(size);

                const volume = size.x * size.y * size.z;
                const surfaceArea = 2 * (size.x * size.y + size.x * size.z + size.y * size.z);

                let ratio = 0;
                if (volume > VOLUME_EPSILON) {
                    ratio = surfaceArea / volume;
                } else {
                    ratio = Infinity;
                }
                if (volume < MAX_VOLUME && ratio > MIN_SURFACE_AREA_TO_VOLUME_RATIO) {
                    if (mesh.parent) {
                        mesh.parent.remove(mesh);
                    }
                } else {
                    mesh.material = standardMaterial;
		            mesh.castShadow = true;
		            mesh.receiveShadow = true;
                    if (mesh.geometry && mesh.geometry.isBufferGeometry) {
                        mesh.geometry.computeVertexNormals();
                    }
                }
            });

            modelBoundingBox = new THREE.Box3().setFromObject(model, true);
            const initialSize = modelBoundingBox.getSize(new THREE.Vector3());

            const targetMaxDim = 10; // Scale to fit within 10 units
            const scaleFactor = targetMaxDim / Math.max(initialSize.x, initialSize.y, initialSize.z);
            model.scale.set(scaleFactor, scaleFactor, scaleFactor);
	        scene.updateMatrixWorld(true);

	        identifyDraggableObjectsByDimension(modelContainer, DRAGGABLE_MAX_DIMENSION, DRAGGABLE_MIN_DIMENSION);
	    

            draggableObjects.forEach(obj => {
                if (obj.isMesh) {
                    if (!originalMaterials.has(obj)) {
                        originalMaterials.set(obj, obj.material);
                    }
                    obj.material = panelMaterial; // Apply draggable material to primary mesh
                }
            });

            modelBoundingBox.setFromObject(model, true);
            const modelCenter = modelBoundingBox.getCenter(new THREE.Vector3());
            model.position.sub(modelCenter);

	        convertDraggableObjectsToLargestPanels();

            baseModelContainer.quaternion.identity();
            modelContainer.quaternion.identity();

            scene.updateMatrixWorld(true);

            draggableObjects.forEach(obj => calculateAndStoreLocalBBoxOffset(obj));
	        getDraggableObjectWorldCoordinates();
            modelBoundingBox.setFromObject(model, true);
            const scaledSize = modelBoundingBox.getSize(new THREE.Vector3());

            cameraDistance = Math.abs(Math.max(scaledSize.x, scaledSize.y, scaledSize.z) / 2 / Math.tan(camera.fov * (Math.PI / 180) / 2)) * 1.5;

            calculateViewPositions(modelBoundingBox, cameraDistance);

            const initialFrontView = initialViewPositions.front;
            camera.position.copy(initialFrontView.position);
            controls.target.copy(initialFrontView.target);
            controls.update();

            updateAxesHelperOrientation();
	        updateSunPosition();
        },
        undefined,
        function (error) {
            console.error('An error occurred while loading the GLB model:', error);
        }

    );

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        TWEEN.update();
        renderer.render(scene, camera);
        renderAxesHelper();
    }
    animate();

    window.addEventListener('resize', onWindowResize, false);
    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const rotationAngleInput = document.getElementById('rotation-angle-input');
    if (rotationAngleInput) {
        rotationAngleInput.value = '20';
    }
    rotationAngleInput.addEventListener('change', (event) => {
        const degrees = parseFloat(event.target.value);
        if (!isNaN(degrees)) {
            rotationAngle = THREE.MathUtils.degToRad(degrees);
        } else {
            event.target.value = THREE.MathUtils.radToDeg(rotationAngle).toFixed(0);
        }
    });

    document.getElementById('view-front').addEventListener('click', () => setView('front'));
    document.getElementById('view-back').addEventListener('click', () => setView('back'));
    document.getElementById('view-top').addEventListener('click', () => setView('top'));
    document.getElementById('view-bottom').addEventListener('click', () => setView('bottom'));
    document.getElementById('view-left').addEventListener('click', () => setView('left'));
    document.getElementById('view-right').addEventListener('click', () => setView('right'));

    document.getElementById('rotate-x-cw').addEventListener('click', () => rotateModel('x', -rotationAngle));
    document.getElementById('rotate-x-cw').addEventListener('mouseenter', () => highlightAxis('x', 'cw'));
    document.getElementById('rotate-x-cw').addEventListener('mouseleave', resetAxisHighlight);

    document.getElementById('rotate-x-ccw').addEventListener('click', () => rotateModel('x', rotationAngle));
    document.getElementById('rotate-x-ccw').addEventListener('mouseenter', () => highlightAxis('x', 'ccw'));
    document.getElementById('rotate-x-ccw').addEventListener('mouseleave', resetAxisHighlight);

    document.getElementById('rotate-y-cw').addEventListener('click', () => rotateModel('y', -rotationAngle));
    document.getElementById('rotate-y-cw').addEventListener('mouseenter', () => highlightAxis('y', 'cw'));
    document.getElementById('rotate-y-cw').addEventListener('mouseleave', resetAxisHighlight);

    document.getElementById('rotate-y-ccw').addEventListener('click', () => rotateModel('y', rotationAngle));
    document.getElementById('rotate-y-ccw').addEventListener('mouseenter', () => highlightAxis('y', 'ccw'));
    document.getElementById('rotate-y-ccw').addEventListener('mouseleave', resetAxisHighlight);

    document.getElementById('rotate-z-cw').addEventListener('click', () => rotateModel('z', -rotationAngle));
    document.getElementById('rotate-z-cw').addEventListener('mouseenter', () => highlightAxis('z', 'cw'));
    document.getElementById('rotate-z-cw').addEventListener('mouseleave', resetAxisHighlight);

    document.getElementById('rotate-z-ccw').addEventListener('click', () => rotateModel('z', rotationAngle));
    document.getElementById('rotate-z-ccw').addEventListener('mouseenter', () => highlightAxis('z', 'ccw'));
    document.getElementById('rotate-z-ccw').addEventListener('mouseleave', resetAxisHighlight);

    const setBaselineBtn = document.getElementById('setBaselineBtn');
    setBaselineBtn.addEventListener('click', setModelBaseline);

    const resetModelBtn = document.getElementById('resetModelOrientationBtn');
    resetModelBtn.addEventListener('click', resetModelOrientation);

    deleteObjectButton = document.getElementById('deleteObjectBtn');
    deleteObjectButton.addEventListener('click', deleteSelectedObject);
    
    addPanelButton = document.getElementById('addPanelBtn');
    addPanelButton.addEventListener('click', addPanel);

    exportButton = document.getElementById('exportBtn');
    exportButton.addEventListener('click', exportModel);

    const coordinateModal = document.getElementById('coordinateModal');
    const coordinateForm = document.getElementById('coordinateForm');
    const cancelBtn = document.getElementById('cancelBtn');
        
    cancelBtn.addEventListener('click', hidePanel);
    coordinateForm.addEventListener('submit', addObjectToScene);
    coordinateModal.addEventListener('click', (event) => {
        if (event.target === coordinateModal) {
            hidePanel();
        }
    });

}


// === Utility Functions ===

// Checks if an object or any of its children is a mesh
function containsMesh(object) {
    if (object.isMesh) {
        return true;
    }
    for (const child of object.children) {
        if (containsMesh(child)) {
            return true;
        }
    }
    return false;
}

// Returns a quaternion for axis rotation (for axes preview and model rotation)
function getAxisRotationQuaternion(axis, angle) {
    const rotationQuaternion = new THREE.Quaternion();
    if (axis === 'x') {
        rotationQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
    } else if (axis === 'y') {
        rotationQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    } else if (axis === 'z') {
        rotationQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    }
    return rotationQuaternion;
}

// Returns the axis line object for a given axis name
function getAxisLine(axisName) {
    if (axisName === 'x') return xAxisLine;
    if (axisName === 'y') return yAxisLine;
    if (axisName === 'z') return zAxisLine;
    return null;
}

// Resets all axis line materials to their original state
function resetAllAxisLineMaterials() {
    [
        { line: xAxisLine, material: originalXMaterial },
        { line: yAxisLine, material: originalYMaterial },
        { line: zAxisLine, material: originalZMaterial }
    ].forEach(({ line, material }) => {
        line.material.copy(material);
        line.material.needsUpdate = true;
    });
}

// Sets mouse coordinates from an event (normalized device coordinates)
function setMouseFromEvent(event, mouse) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
}

// Returns the inverse of the parent matrixWorld, or identity if no parent
function getInverseParentMatrixWorld(object) {
    const parentMatrixWorld = object.parent ? object.parent.matrixWorld : new THREE.Matrix4().identity();
    return parentMatrixWorld.clone().invert();
}

// Gets or calculates the local offset from pivot to bounding box center
function getOrCalculateLocalOffset(object) {
    let localOffset = localPivotToBBoxCenterOffsets.get(object);
    if (!localOffset) {
        calculateAndStoreLocalBBoxOffset(object);
        localOffset = localPivotToBBoxCenterOffsets.get(object) || new THREE.Vector3(0, 0, 0);
    }
    return localOffset;
}

const _tempBBox = new THREE.Box3();
const _tempSize = new THREE.Vector3();

// Returns the smallest mesh in a group based on volume
function getPrimaryMeshInGroup(group) {
    let primaryMesh = null;
    let smallestVolume = Infinity;

    group.traverse((child) => {
        if (child.isMesh) {
            if (!child.geometry.boundingBox) {
                child.geometry.computeBoundingBox();
            }
            const size = new THREE.Vector3();
            child.geometry.boundingBox.getSize(size);
            const volume = size.x * size.y * size.z;
            if (volume < smallestVolume) {
                smallestVolume = volume;
                primaryMesh = child;
            }
        }
    });
    return primaryMesh;
}

// Obtain draggable objects' world coordinates
function getDraggableObjectWorldCoordinates() {
    draggableObjects.forEach(object => {
        if (object.isMesh && object.geometry) {
            console.log(`Coordinates for object: ${object.name || 'Unnamed Object'}`);

            const positionAttribute = object.geometry.attributes.position;
            if (positionAttribute) {
                const vertex = new THREE.Vector3();
                for (let i = 0; i < positionAttribute.count; i++) {
                    vertex.fromBufferAttribute(positionAttribute, i);

                    // Apply the object's world transformation to get the final world coordinates
                    vertex.applyMatrix4(object.matrixWorld);

                    console.log(`  Vertex ${i}: (${vertex.x.toFixed(3)}, ${vertex.y.toFixed(3)}, ${vertex.z.toFixed(3)})`);
                }
            } else {
                console.log("  No position attribute found in geometry.");
            }
        }
    });
}

// Calculates the local offset from the pivot to the bounding box center
function calculateAndStoreLocalBBoxOffset(object) {
    object.updateWorldMatrix(true, false);

    const worldBBox = new THREE.Box3().setFromObject(object, true);
    const worldBBoxCenter = new THREE.Vector3();
    worldBBox.getCenter(worldBBoxCenter);

    const worldPivotPosition = new THREE.Vector3();
    object.getWorldPosition(worldPivotPosition);

    const worldOffsetFromPivotToBBoxCenter = worldBBoxCenter.clone().sub(worldPivotPosition);

    const inverseWorldQuaternion = object.getWorldQuaternion(new THREE.Quaternion()).invert();
    const localOffset = worldOffsetFromPivotToBBoxCenter.applyQuaternion(inverseWorldQuaternion);

    localPivotToBBoxCenterOffsets.set(object, localOffset);
}

// Draggable objects identified based on dimensions
function identifyDraggableObjectsByDimension(rootObject, maxDimensionThreshold, minDimensionThreshold) {
    draggableObjects.clear();
    console.log(`--- Identifying Draggable Objects (Max: ${maxDimensionThreshold}, Min: ${minDimensionThreshold}) ---`);

    const objectsToProcessForDraggability = [];

    // First pass: Identify all potential draggable candidates (Groups or single Meshes)
    rootObject.traverse((object) => {
        if (object === rootObject || !object.parent) return;

	    if (object.isMesh && object.userData.is2DPanel) {
            objectsToProcessForDraggability.push(object);
            return; // Skip dimension checks
        }

        if (!object.isMesh && !object.isGroup) {
            return;
        }

        if (!containsMesh(object)) {
            return;
        }

        _tempBBox.setFromObject(object, true);

        if (_tempBBox.isEmpty() || (_tempBBox.max.x === _tempBBox.min.x && _tempBBox.max.y === _tempBBox.min.y && _tempBBox.max.z === _tempBBox.min.z)) {
            return;
        }

        _tempBBox.getSize(_tempSize);

        const maxDim = Math.max(_tempSize.x, _tempSize.y, _tempSize.z);
        const minDim = Math.min(_tempSize.x, _tempSize.y, _tempSize.z);

        if (maxDim <= maxDimensionThreshold && minDim >= minDimensionThreshold) {
            objectsToProcessForDraggability.push(object);
        }
    });

    // Second pass: Determine the highest valid ancestor and its primary mesh
    const processedObjects = new Set();

    objectsToProcessForDraggability.forEach(object => {
        if (processedObjects.has(object)) {
            return; // Already handled as part of a higher ancestor
        }

	    if (object.isMesh && object.userData.is2DPanel) {
            draggableObjects.add(object);
            console.log(`  -> Added to draggableObjects (2D Panel): ${object.name || object.uuid}`);
            processedObjects.add(object);
            return;
        }

        let highestValidAncestor = object;
        let current = object.parent;

        while (current && current !== rootObject) {
            _tempBBox.setFromObject(current, true);
            if (_tempBBox.isEmpty() || (_tempBBox.max.x === _tempBBox.min.x && _tempBBox.max.y === _tempBBox.min.y && _tempBBox.max.z === _tempBBox.min.z)) {
                break;
            }
            _tempBBox.getSize(_tempSize);
            const parentMaxDim = Math.max(_tempSize.x, _tempSize.y, _tempSize.z);
            const parentMinDim = Math.min(_tempSize.x, _tempSize.y, _tempSize.z);

            if (parentMaxDim <= maxDimensionThreshold && parentMinDim >= minDimensionThreshold) {
                highestValidAncestor = current;
            } else {
                break;
            }
            current = current.parent;
        }

        // Get the primary mesh within this highest valid ancestor
        const primaryMesh = getPrimaryMeshInGroup(highestValidAncestor);

        if (primaryMesh) {
            draggableObjects.add(primaryMesh);
            console.log(`  -> Added to draggableObjects: ${primaryMesh.name || primaryMesh.uuid} (from group ${highestValidAncestor.name || highestValidAncestor.uuid})`);

            // Remove other meshes from the highestValidAncestor
            const meshesToRemove = [];
            highestValidAncestor.traverse((child) => {
                if (child.isMesh && child !== primaryMesh && child.parent === highestValidAncestor) {
                    // Only remove direct children meshes of the highestValidAncestor
                    // This prevents accidentally removing meshes from nested draggable groups
                    meshesToRemove.push(child);
                }
            });

            meshesToRemove.forEach(mesh => {
                if (mesh.parent) {
                    mesh.parent.remove(mesh);
                    // Dispose geometry and materials if they are not shared
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(mat => mat.dispose());
                    } else if (mesh.material) {
                        mesh.material.dispose();
                    }
                    console.log(`- Removed mesh: ${mesh.name || mesh.uuid}`);
                }
            });
        }

        // Mark all objects under this highestValidAncestor as processed
        highestValidAncestor.traverse((child) => processedObjects.add(child));
    });
    console.log(`--- Finished Identifying Draggable Objects. Total: ${draggableObjects.size} ---`);
}

// === UI Event Handlers ===
function updateCoordPopup(object) {
    let worldPos = new THREE.Vector3();
    object.updateWorldMatrix(true, false);
    const bbox = new THREE.Box3().setFromObject(object, true);
    bbox.getCenter(worldPos);

    coordXInput.value = (Math.abs(worldPos.x) < 0.005 ? 0 : worldPos.x).toFixed(2);
    coordYInput.value = (Math.abs(worldPos.y) < 0.005 ? 0 : worldPos.y).toFixed(2);
    coordZInput.value = (Math.abs(worldPos.z) < 0.005 ? 0 : worldPos.z).toFixed(2);

    // Set input accessibility based on draggable status
    const isObjectDraggable = draggableObjects.has(object);
    coordXInput.disabled = !isObjectDraggable;
    coordYInput.disabled = !isObjectDraggable;
    coordZInput.disabled = !isObjectDraggable;

    deleteObjectButton.style.display = 'block'; // Show delete button when an object is selected
}

function onCoordInputChange() {
    if (!intersectedObject) {
        return;
    }

    // Do not allow movement if the object is not draggable
    if (!draggableObjects.has(intersectedObject)) {
        updateCoordPopup(intersectedObject);
        return;
    }

    let newX = parseFloat(coordXInput.value);
    let newY = parseFloat(coordYInput.value);
    let newZ = parseFloat(coordZInput.value);

    if (isNaN(newX) || isNaN(newY) || isNaN(newZ)) {
        intersectedObject.updateWorldMatrix(true, false);
        updateCoordPopup(intersectedObject);
        return;
    }

    scene.updateMatrixWorld(true);

    let localOffset = localPivotToBBoxCenterOffsets.get(intersectedObject);
    if (!localOffset) {
        calculateAndStoreLocalBBoxOffset(intersectedObject);
        localOffset = localPivotToBBoxCenterOffsets.get(intersectedObject);
        if (!localOffset) {
            localOffset = new THREE.Vector3(0, 0, 0);
        }
    }

    const desiredWorldBBoxCenter = new THREE.Vector3(newX, newY, newZ);

    const worldOrientedOffsetFromPivotToBBoxCenter = localOffset.clone().applyQuaternion(
        intersectedObject.getWorldQuaternion(new THREE.Quaternion())
    );

    const desiredObjectPivotWorldPosition = desiredWorldBBoxCenter.clone().sub(worldOrientedOffsetFromPivotToBBoxCenter);

    const parentMatrixWorld = intersectedObject.parent ? intersectedObject.parent.matrixWorld : new THREE.Matrix4().identity();
    const inverseParentMatrixWorld = parentMatrixWorld.clone().invert();

    const newObjectLocalPosition = desiredObjectPivotWorldPosition.applyMatrix4(inverseParentMatrixWorld);
    intersectedObject.position.copy(newObjectLocalPosition);

    intersectedObject.updateWorldMatrix(true, false);
    scene.updateMatrixWorld(true);

    updateCoordPopup(intersectedObject);
    const shadowCoverage = calculateShadowCoverage(intersectedObject);
    showShadowCoveragePopup(intersectedObject, shadowCoverage);
    controls.update();
}

function showCoordPopup() {
    coordPopup.style.display = 'flex';
}

function hideCoordPopup() {
    coordPopup.style.display = 'none';
    deleteObjectButton.style.display = 'none';

    if (intersectedObject) {
        restoreOriginalMaterials(intersectedObject);
        intersectedObject = null;
    }

    isDragging = false;
    pointerDownOnDraggable = false;
}

function showShadowCoveragePopup(object, coverage) {
    shadowCoverageText.textContent = `${coverage}%`;
    shadowCoveragePopup.style.display = 'flex';
}

function hideShadowCoveragePopup() {
    shadowCoveragePopup.style.display = 'none';
}

function calculateViewPositions(bbox, distance) {
    const target = new THREE.Vector3(0, 0, 0);

    const baseFront = new THREE.Vector3(0, 0, 1);
    const baseBack = new THREE.Vector3(0, 0, -1);
    const baseTop = new THREE.Vector3(0, 1, 0);
    const baseBottom = new THREE.Vector3(0, -1, 0);
    const baseLeft = new THREE.Vector3(-1, 0, 0);
    const baseRight = new THREE.Vector3(1, 0, 0);

    initialViewPositions.front = { position: target.clone().add(baseFront.clone().multiplyScalar(distance)), target: target.clone() };
    initialViewPositions.back = { position: target.clone().add(baseBack.clone().multiplyScalar(distance)), target: target.clone() };
    initialViewPositions.top = { position: target.clone().add(baseTop.clone().multiplyScalar(distance)), target: target.clone() };
    initialViewPositions.bottom = { position: target.clone().add(baseBottom.clone().multiplyScalar(distance)), target: target.clone() };
    initialViewPositions.left = { position: target.clone().add(baseLeft.clone().multiplyScalar(distance)), target: target.clone() };
    initialViewPositions.right = { position: target.clone().add(baseRight.clone().multiplyScalar(distance)), target: target.clone() };
}

function setView(viewName) {
    if (!modelContainer || !baseModelContainer) {
        return;
    }

    const initialTargetView = initialViewPositions[viewName];

    if (initialTargetView) {
        const finalPosition = initialTargetView.position.clone();
        const finalTarget = initialTargetView.target.clone();

        controls.enabled = false;

        const currentCameraPosition = camera.position.clone();
        const currentControlsTarget = controls.target.clone();

        const offsetFromCurrentTarget = currentCameraPosition.clone().sub(currentControlsTarget);
        const currentSpherical = new THREE.Spherical().setFromVector3(offsetFromCurrentTarget);

        const offsetFromFinalTarget = finalPosition.clone().sub(finalTarget);
        const targetSpherical = new THREE.Spherical().setFromVector3(offsetFromFinalTarget);

        let angleDifference = targetSpherical.theta - currentSpherical.theta;
        if (angleDifference > Math.PI) {
            targetSpherical.theta -= 2 * Math.PI;
        } else if (angleDifference < -Math.PI) {
            targetSpherical.theta += 2 * Math.PI;
        }

        new TWEEN.Tween(currentSpherical)
            .to({ phi: targetSpherical.phi, theta: targetSpherical.theta }, 1000)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onUpdate(() => {
                const newCameraPositionOffset = new THREE.Vector3().setFromSphericalCoords(
                    cameraDistance,
                    currentSpherical.phi,
                    currentSpherical.theta
                );
                camera.position.copy(newCameraPositionOffset.add(controls.target));
                camera.lookAt(controls.target);
            })
            .start();

        new TWEEN.Tween(controls.target)
            .to(finalTarget, 1000)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onComplete(() => {
                controls.enabled = true;
                controls.update();
                updateAxesHelperOrientation(); // Ensure helper is aligned after camera movement
            })
            .start();
    }
}

// Rotates the model and axes helper by the specified axis and angle
function rotateModel(axis, angle) {
    if (!modelContainer || !baseModelContainer) {
        return;
    }

    controls.enabled = false;

    // Calculate rotation for modelContainer relative to current baseline
    const baseModelWorldQuaternion = baseModelContainer.getWorldQuaternion(new THREE.Quaternion());
    let worldRotationAxis = new THREE.Vector3();
    if (axis === 'x') {
        worldRotationAxis.set(1, 0, 0);
    } else if (axis === 'y') {
        worldRotationAxis.set(0, 1, 0);
    } else if (axis === 'z') {
        worldRotationAxis.set(0, 0, 1);
    }
    const inverseBaseModelWorldQuaternion = baseModelWorldQuaternion.clone().invert();
    const localRotationAxis = worldRotationAxis.applyQuaternion(inverseBaseModelWorldQuaternion);
    const rotationQuaternionForModel = new THREE.Quaternion().setFromAxisAngle(localRotationAxis, angle);
    const targetModelContainerQuaternion = modelContainer.quaternion.clone().multiply(rotationQuaternionForModel);

    // Calculate the permanent orientation for the axes helper
    const rotationQuaternionForAxes = getAxisRotationQuaternion(axis, angle);
    const targetPermanentAxesRotation = customAxesRotation.clone().multiply(rotationQuaternionForAxes);

    // Start the axes helper tween from its currently displayed quaternion
    const startDisplayedAxesQuaternion = customAxes.quaternion.clone();

    // Stop any ongoing preview tween if it exists
    if (currentHoveredAxisPreviewTween) {
        currentHoveredAxisPreviewTween.stop();
        currentHoveredAxisPreviewTween = null;
    }

    // Tween the axes helper's displayed quaternion (customAxes.quaternion) to the calculated target permanent quaternion
    new TWEEN.Tween(startDisplayedAxesQuaternion)
        .to(targetPermanentAxesRotation, 500)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(() => {
            customAxes.quaternion.copy(startDisplayedAxesQuaternion);
        })
        .onComplete(() => {
            customAxesRotation.copy(targetPermanentAxesRotation);
            controls.enabled = true;
            controls.update();
        })
        .start();

    new TWEEN.Tween(modelContainer.quaternion)
        .to(targetModelContainerQuaternion, 500)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onComplete(() => {
            modelContainer.quaternion.copy(targetModelContainerQuaternion);
            scene.updateMatrixWorld(true);
            draggableObjects.forEach(obj => calculateAndStoreLocalBBoxOffset(obj));
	    
	        if (intersectedObject && draggableObjects.has(intersectedObject)) {
                const shadowCoverage = calculateShadowCoverage(intersectedObject);
                showShadowCoveragePopup(intersectedObject, shadowCoverage);
            }
        })
        .start();
}

// Resets the model and axes helper to the baseline orientation
function resetModelOrientation() {
    return new Promise(resolve => { 
    	if (!modelContainer || !baseModelContainer) {
            return;
    	}

        controls.enabled = false;

        const startQuaternionModel = modelContainer.quaternion.clone();
        const endQuaternionModel = new THREE.Quaternion().identity();

        const startDisplayedAxesQuaternion = customAxes.quaternion.clone();
        const endCustomAxesQuaternion = new THREE.Quaternion().identity();

        // Stop any ongoing preview tween
        if (currentHoveredAxisPreviewTween) {
            currentHoveredAxisPreviewTween.stop();
            currentHoveredAxisPreviewTween = null;
    	}
	    setView('front');
    	new TWEEN.Tween(startQuaternionModel)
            .to(endQuaternionModel, 500)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(() => {
            	modelContainer.quaternion.copy(startQuaternionModel);
            })
            .onComplete(() => {
            	modelContainer.quaternion.identity();
            	scene.updateMatrixWorld(true);
            	draggableObjects.forEach(obj => calculateAndStoreLocalBBoxOffset(obj));
            	
	    	    if (intersectedObject && draggableObjects.has(intersectedObject)) {
                    const shadowCoverage = calculateShadowCoverage(intersectedObject);
                    showShadowCoveragePopup(intersectedObject, shadowCoverage);
                }

		        resolve();
            })
            .start();

    	// Separate axes display tween from model tween
     	new TWEEN.Tween(startDisplayedAxesQuaternion)
            .to(endCustomAxesQuaternion, 500)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(() => {
            	customAxes.quaternion.copy(startDisplayedAxesQuaternion);
            })
            .onComplete(() => {
            	customAxesRotation.copy(endCustomAxesQuaternion);
            	controls.enabled = true;
            	controls.update();
            })
            .start();
    })
}

// Sets the model's current orientation as the baseline
function setModelBaseline() {
    if (!modelContainer || !baseModelContainer || !model) {
        return;
    }

    const currentModelWorldQuaternion = new THREE.Quaternion();
    model.getWorldQuaternion(currentModelWorldQuaternion);

    baseModelContainer.quaternion.copy(currentModelWorldQuaternion);

    modelContainer.quaternion.identity(); // Resets model's local rotation relative to the new baseline
    customAxesRotation.identity();

    scene.updateMatrixWorld(true);
    draggableObjects.forEach(obj => calculateAndStoreLocalBBoxOffset(obj));

    updateAxesHelperOrientation(); // Make customAxes.quaternion = identity()
    controls.update();
}

function updateAxesHelperOrientation() {
    if (customAxes) {
        customAxes.quaternion.copy(customAxesRotation);
    }
}

function restoreOriginalMaterials(objectToRestore) {
    if (!objectToRestore) return;

    if (objectToRestore.isMesh) {
        const originalMaterial = originalMaterials.get(objectToRestore);
        if (originalMaterial) {
            objectToRestore.material = originalMaterial;
            originalMaterials.delete(objectToRestore);
        }
    }
}

// Determine the plane for dragging based on camera direction and object position
function setupDragPlane(objectWorldPosition) {
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    let planeNormal = new THREE.Vector3();
    const absX = Math.abs(cameraDirection.x);
    const absY = Math.abs(cameraDirection.y);
    const absZ = Math.abs(cameraDirection.z);

    // Prioritize axis aligned to the camera's view that is most perpendicular to the camera's view
    if (absY >= absX && absY >= absZ) {
        planeNormal.set(0, 1, 0); // Use Y-Z plane if camera is looking mostly along Y
    } else if (absZ >= absX && absZ >= absY) {
        planeNormal.set(0, 0, 1); // Use X-Y plane if camera is looking mostly along Z
    } else {
        planeNormal.set(1, 0, 0); // Use Y-Z plane if camera is looking mostly along X
    }

    // Ensure plane normal points towards the camera
    if (planeNormal.dot(camera.position.clone().sub(objectWorldPosition)) < 0) {
        planeNormal.negate();
    }

    plane.setFromNormalAndCoplanarPoint(planeNormal, objectWorldPosition);

    const initialIntersectionPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, initialIntersectionPoint);

    const currentWorldBBoxCenter = new THREE.Vector3();
    new THREE.Box3().setFromObject(intersectedObject, true).getCenter(currentWorldBBoxCenter);

    _dragOffset.copy(initialIntersectionPoint).sub(currentWorldBBoxCenter);
}

function onPointerDown(event) {
    if (!modelContainer || !baseModelContainer) {
        return;
    }

    // Prevent interaction with UI controls
    if (event.target.closest('.control-group')
	|| event.target === deleteObjectButton
	|| event.target === exportButton
	|| event.target === addPanelButton
	|| event.target.closest('#coordinate-popup')
	|| event.target.closest('#shadow-coverage-popup')
	|| event.target.closest('#light-controls-container')) {
        console.log("Clicked on UI control, ignoring.");
        return;
    }

    event.preventDefault(); // Prevent default form submission behavior (page reload)

    setMouseFromEvent(event, mouse);
    raycaster.setFromCamera(mouse, camera);
    scene.updateMatrixWorld(true);

    const allIntersects = raycaster.intersectObject(modelContainer, true);
    let newSelectedObject = null;

    if (allIntersects.length > 0) {
        const closestIntersectedMesh = allIntersects[0].object;
        if (draggableObjects.has(closestIntersectedMesh)) {
            newSelectedObject = closestIntersectedMesh;
        } else {
            let currentHierarchyObject = closestIntersectedMesh;
            while (currentHierarchyObject && currentHierarchyObject !== modelContainer) {
                if (draggableObjects.has(currentHierarchyObject)) { // Check if any ancestor is the primary mesh of a draggable group
                    newSelectedObject = currentHierarchyObject;
                    break;
                }
                currentHierarchyObject = currentHierarchyObject.parent;
            }
        }

        // If after all checks, no draggable object was found but a mesh was clicked, select that mesh
        if (!newSelectedObject && closestIntersectedMesh.isMesh) {
            newSelectedObject = closestIntersectedMesh;
        }
    }

    if (newSelectedObject) {
        console.log(`PointerDown: Final selected object for interaction: ${newSelectedObject.name || newSelectedObject.uuid}`);

        // If a new object is selected or nothing was selected before
        if (intersectedObject !== newSelectedObject) {
            if (intersectedObject) {
                restoreOriginalMaterials(intersectedObject);
            }
            intersectedObject = newSelectedObject;
            originalMaterials.clear();
            intersectedObject.traverse(child => {
                if (child.isMesh) {
                    originalMaterials.set(child, child.material);
                    child.material = highlightMaterial;
                }
            });
            updateCoordPopup(intersectedObject);
            showCoordPopup();
            hideShadowCoveragePopup();

            // Determine if the newly selected object is draggable using the draggableObjects Set
            pointerDownOnDraggable = draggableObjects.has(newSelectedObject);
            console.log(`  - Is draggable? ${pointerDownOnDraggable}`);
            controls.enabled = !pointerDownOnDraggable;
            console.log(`  - Controls enabled after setting: ${controls.enabled}`);

            if (pointerDownOnDraggable) {
                const shadowCoverage = calculateShadowCoverage(intersectedObject);
                showShadowCoveragePopup(intersectedObject, shadowCoverage);

                const tempBBoxCenter = new THREE.Vector3();
                new THREE.Box3().setFromObject(intersectedObject, true).getCenter(tempBBoxCenter);
                setupDragPlane(tempBBoxCenter);
                renderer.domElement.style.cursor = 'grab';
            } else {
                renderer.domElement.style.cursor = 'auto';
            }
        } else { // Same object re-clicked (intersectedObject === newSelectedObject)
            console.log(`PointerDown: Re-clicked same object: ${intersectedObject.name || intersectedObject.uuid}`);
            if (draggableObjects.has(intersectedObject)) {
                pointerDownOnDraggable = true;
                controls.enabled = false;
                console.log(`  - Controls enabled after re-click on draggable: ${controls.enabled}`);
                const tempBBoxCenter = new THREE.Vector3();
                new THREE.Box3().setFromObject(intersectedObject, true).getCenter(tempBBoxCenter);
                setupDragPlane(tempBBoxCenter);
                renderer.domElement.style.cursor = 'grab';
            } else {
                pointerDownOnDraggable = false;
                controls.enabled = true;
                console.log(`  - Controls enabled after re-click on non-draggable: ${controls.enabled}`);
                renderer.domElement.style.cursor = 'auto';
            }
        }
    } else { // Clicked outside the model container entirely or on model background
        console.log("PointerDown: Clicked outside model or on background.");
        if (intersectedObject) {
            restoreOriginalMaterials(intersectedObject); // Deselect previously selected object
            intersectedObject = null;
            hideCoordPopup();
            hideShadowCoveragePopup();
        }
        controls.enabled = true;
        renderer.domElement.style.cursor = 'auto';
        pointerDownOnDraggable = false;
    }
}

function onPointerMove(event) {
    event.preventDefault();
    setMouseFromEvent(event, mouse);
    raycaster.setFromCamera(mouse, camera);

    if (pointerDownOnDraggable && (event.buttons === 1)) { // If pointer is down on a draggable object and left mouse button is pressed
        if (!isDragging) {
            const dx = event.movementX || 0;
            const dy = event.movementY || 0;
            const distanceMoved = Math.sqrt(dx * dx + dy * dy);
            if (distanceMoved > 2) { // Threshold to prevent accidental drags
                isDragging = true;
            }
        }

        if (isDragging && intersectedObject) {
            scene.updateMatrixWorld(true);
            const newIntersectionPoint = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(plane, newIntersectionPoint)) {
                const desiredWorldBBoxCenter = newIntersectionPoint.sub(_dragOffset);
                const localOffset = getOrCalculateLocalOffset(intersectedObject);
                const worldOrientedOffsetFromPivotToBBoxCenter = localOffset.clone().applyQuaternion(
                    intersectedObject.getWorldQuaternion(new THREE.Quaternion())
                );

                const desiredObjectPivotWorldPosition = desiredWorldBBoxCenter.clone().sub(worldOrientedOffsetFromPivotToBBoxCenter);
                const inverseParentMatrixWorld = getInverseParentMatrixWorld(intersectedObject);
                const newObjectLocalPosition = desiredObjectPivotWorldPosition.applyMatrix4(inverseParentMatrixWorld);
                intersectedObject.position.copy(newObjectLocalPosition);
                scene.updateMatrixWorld(true);

                updateCoordPopup(intersectedObject);
                const shadowCoverage = calculateShadowCoverage(intersectedObject);
                showShadowCoveragePopup(intersectedObject, shadowCoverage);
                renderer.domElement.style.cursor = 'grabbing';
            }
        } else if (pointerDownOnDraggable) {
            renderer.domElement.style.cursor = 'grab';
        }
    } else {
        isDragging = false;
        scene.updateMatrixWorld(true);
        const allIntersects = raycaster.intersectObject(modelContainer, true);
        let foundHoverableDraggable = null;

        if (allIntersects.length > 0) {
            let currentHovered = allIntersects[0].object;
            while (currentHovered && currentHovered !== modelContainer) {
                if (draggableObjects.has(currentHovered)) {
                    foundHoverableDraggable = currentHovered;
                    break;
                }
                currentHovered = currentHovered.parent;
            }
        }

        if (foundHoverableDraggable) {
            renderer.domElement.style.cursor = 'pointer';
        } else {
            renderer.domElement.style.cursor = 'auto';
        }
    }
}

function onPointerUp(event) {
    event.preventDefault();

    controls.enabled = true;
    isDragging = false;
    pointerDownOnDraggable = false;
    scene.updateMatrixWorld(true);
    setMouseFromEvent(event, mouse);
    raycaster.setFromCamera(mouse, camera);

    const allIntersects = raycaster.intersectObject(modelContainer, true);
    let foundHoverableDraggable = null;
    if (allIntersects.length > 0) {
        let currentHovered = allIntersects[0].object;
        while (currentHovered && currentHovered !== modelContainer) {
            if (draggableObjects.has(currentHovered)) {
                foundHoverableDraggable = currentHovered;
                break;
            }
            currentHovered = currentHovered.parent;
        }
    }

    if (foundHoverableDraggable) {
        renderer.domElement.style.cursor = 'pointer';
    } else {
        renderer.domElement.style.cursor = 'auto';
    }
}

function deleteSelectedObject() {
    if (intersectedObject) {
        const objectName = intersectedObject.name || intersectedObject.uuid;
        if (confirm(`Are you sure you want to delete the selected object (${objectName})?`)) {
            const parentGroup = intersectedObject.parent;

            if (intersectedObject.parent) {
                intersectedObject.parent.remove(intersectedObject);
                
                // Dispose resources of the deleted mesh
                if (intersectedObject.geometry) intersectedObject.geometry.dispose();
                if (Array.isArray(intersectedObject.material)) {
                    intersectedObject.material.forEach(material => material.dispose());
                } else if (intersectedObject.material) {
                    intersectedObject.material.dispose();
                }
            }

            // Clean up from draggable sets and maps
            draggableObjects.delete(intersectedObject);
            localPivotToBBoxCenterOffsets.delete(intersectedObject);

            if (parentGroup && parentGroup !== modelContainer && parentGroup.children.length === 0) {
                if (parentGroup.parent) {
                    parentGroup.parent.remove(parentGroup);
                    console.log(`Removed empty parent group: ${parentGroup.name || parentGroup.uuid}`);
                }
            }

            hideCoordPopup();
            hideShadowCoveragePopup();
            renderer.domElement.style.cursor = 'auto';
            controls.enabled = true;

            scene.updateMatrixWorld(true);
        }
    }
}

function addPanel() {
    coordinateModal.classList.add('show');
}

function hidePanel() {
    coordinateModal.classList.remove('show');
    coordinateForm.reset(); // Clear all form fields
}

function addObjectToScene(event) {
    event.preventDefault();

    const points = [];
    let allValid = true;

    // Collect coordinates from 4 sets of inputs, and create THREE.Vector3 objects
    for (let i = 1; i <= 4; i++) {
        const x = parseFloat(document.getElementById(`x${i}`).value);
        const y = parseFloat(document.getElementById(`y${i}`).value);
        const z = parseFloat(document.getElementById(`z${i}`).value);

        // Validate if inputs are numbers
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            allValid = false;
            break;
        }
        points.push(new THREE.Vector3(x, y, z));
    }

    if (!allValid) {
        alert('Please enter valid numerical coordinates for all points.');
        return;
    }

    const p1 = points[0];
    const p2 = points[1];
    const p3 = points[2];
    const p4 = points[3];

    scene.updateMatrixWorld(true);

    // Gets the inverse of the baseModelContainer's world matrix
    const inverseBaseModelWorldMatrix = baseModelContainer.matrixWorld.clone().invert();

    // Apply inverse transformation to each point before checks and geometry creation
    p1.applyMatrix4(inverseBaseModelWorldMatrix);
    p2.applyMatrix4(inverseBaseModelWorldMatrix);
    p3.applyMatrix4(inverseBaseModelWorldMatrix);
    p4.applyMatrix4(inverseBaseModelWorldMatrix);


    // Define a small epsilon for floating point comparisons
    const EPSILON = 0.01; // For coplanarity check
    const COLLINEARITY_EPSILON_SQ = 0.0001; // For collinearity check

    const v1_2 = new THREE.Vector3().subVectors(p2, p1);
    const v1_3 = new THREE.Vector3().subVectors(p3, p1);

    // Calculate the normal vector of the plane using the cross product
    const normal = new THREE.Vector3().crossVectors(v1_2, v1_3).normalize();

    // Check if the first three points are collinear (cross product will be zero)
    if ((v1_2.clone()).cross(v1_3).lengthSq() < COLLINEARITY_EPSILON_SQ) {
        alert("The first three points (P1, P2, P3) are collinear. Please choose points that form a non-degenerate triangle for the base.");
        return;
    }

    // Check if the fourth point lies on the plane
    const vectorP4toP1 = new THREE.Vector3().subVectors(p4, p1);
    const dotProduct = vectorP4toP1.dot(normal);

    if (Math.abs(dotProduct) > EPSILON) {
        // Fourth point is not on the plane, suggest a corrected point
        const projectedP4 = new THREE.Vector3().subVectors(
            p4,
            normal.clone().multiplyScalar(dotProduct)
        );

        alert(
            `The fourth point is not on the same plane as the first three. ` +
            `Suggested fourth point to be on the plane: ` +
            `X: ${projectedP4.x.toFixed(2)}, ` +
            `Y: ${projectedP4.y.toFixed(2)}, ` +
            `Z: ${projectedP4.z.toFixed(2)}`
        );
        return;
    }

    // Check for collinearity of any three other points (potentially leading to a degenerate second triangle)
    const v1_4 = new THREE.Vector3().subVectors(p4, p1);
    const v2_3 = new THREE.Vector3().subVectors(p3, p2);
    const v2_4 = new THREE.Vector3().subVectors(p4, p2);
    if ((v1_3.clone()).cross(v1_4).lengthSq() < COLLINEARITY_EPSILON_SQ || (v1_2.clone()).cross(v1_4).lengthSq() < COLLINEARITY_EPSILON_SQ || (v2_3.clone()).cross(v2_4).lengthSq() < COLLINEARITY_EPSILON_SQ) {
        alert("Three points are collinear, resulting in a degenerate second triangle. This will cause the panel to appear as a triangle. Please adjust your input to form a valid quadrilateral.");
        return;
    }

    // If all points are in the same plane and no degenerate triangles are formed, create the panel
    const geometry = new THREE.BufferGeometry();
    
    const positions = new Float32Array([
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z,
        p4.x, p4.y, p4.z
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Define indices for a planar quad (two triangles)
    // Points are given in a generally clockwise or counter-clockwise order for a quad
    const indices = new Uint16Array([
        0, 1, 2,  // First triangle (P1, P2, P3)
        0, 2, 3   // Second triangle (P1, P3, P4)
    ]);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Compute vertex normals for lighting
    geometry.computeVertexNormals();

    const customObject = new THREE.Mesh(geometry, panelMaterial);
    customObject.name = `CustomPanel_${Date.now()}`; // Unique identifier
    customObject.castShadow = true;
    customObject.receiveShadow = true;
    customObject.userData.is2DPanel = true;

    if (modelContainer) {
        modelContainer.add(customObject);
    } else {
        scene.add(customObject);
    }

    draggableObjects.add(customObject);
    console.log(`Added new panel to draggableObjects: ${customObject.name}`);

    originalMaterials.set(customObject, panelMaterial);

    // Calculate and store the local bounding box offset
    calculateAndStoreLocalBBoxOffset(customObject);

    // Update scene to reflect changes
    scene.updateMatrixWorld(true);

    hidePanel();
    alert('Panel added successfully!');
}

async function exportModel() {
    const exporter = new GLTFExporter();
    const exportScene = new THREE.Scene();

    await resetModelOrientation();

    await new Promise(resolve => setTimeout(resolve, 500)); 

    if (!baseModelContainer) {
        console.error("No model to export. `baseModelContainer` is not defined.");
        alert("No model to export.");
        return;
    }

    const options = {
        trs: false, // Keep transformations as they are
        onlyVisible: true, // Only export visible objects
        binary: true, // Export as GLB
        includeCustomExtensions: true // Preserves is2DPanel attribute
    };

    try {
        const gltfBlob = await new Promise(resolve => {
            exporter.parse(
                baseModelContainer,
                function (result) {
                    const blob = new Blob([result], { type: 'model/gltf-binary' });
                    resolve(blob);
                },
                function (error) {
                    console.error('An error happened during GLB export: ', error);
                    resolve(null);
                },
                options
            );
        });

        if (gltfBlob) {
            const url = URL.createObjectURL(gltfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'saved_model.glb';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('Model successfully exported.');
            alert('Model exported successfully as saved_model.glb!');
        } else {
            console.warn('Export failed/no data returned.');
            alert('Model export failed.');
        }
    } catch (error) {
        console.error('Error during export process:', error);
        alert('An error occurred during export.');
    }
}


document.addEventListener('pointerdown', (event) => {
    const clickedOnCanvas = event.target === renderer.domElement;
    const clickedOnControlElement = event.target.closest('.control-group') !== null;
    const clickedOnDeleteButton = event.target === deleteObjectButton;
    const clickedOnAddButton = event.target === addPanelButton;
    const clickedOnExportButton = event.target === exportButton;
    const clickedOnCoordPopup = event.target.closest('#coordinate-popup') !== null;
    const clickedOnShadowPopup = event.target.closest('#shadow-coverage-popup') !== null;
    const clickedOnLightControls = event.target.closest('#light-controls-container') !== null;


    // If click was outside UI controls, and an object is selected, then hide the popup
    if (!clickedOnCanvas && !clickedOnControlElement && !clickedOnDeleteButton && !clickedOnAddButton && !clickedOnExportButton && !clickedOnCoordPopup && !clickedOnShadowPopup && !clickedOnLightControls && intersectedObject) {
        hideCoordPopup();
        hideShadowCoveragePopup();
        renderer.domElement.style.cursor = 'auto';
    } else if (clickedOnCanvas && !isDragging && !clickedOnDeleteButton && !clickedOnAddButton && !clickedOnExportButton) { // If clicked on canvas but not dragging
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        scene.updateMatrixWorld(true);

        const allIntersects = raycaster.intersectObject(modelContainer, true);
        let foundAnyObject = null;

        if (allIntersects.length > 0) {
            let currentObjectInHierarchy = allIntersects[0].object;
            while (currentObjectInHierarchy && currentObjectInHierarchy !== modelContainer) {
                if (containsMesh(currentObjectInHierarchy)) {
                    foundAnyObject = currentObjectInHierarchy;
                    break;
                }
                currentObjectInHierarchy = currentObjectInHierarchy.parent;
            }
        }
        // If clicked on empty space (no object found) and an object was previously selected
        if (!foundAnyObject && intersectedObject) {
            hideCoordPopup();
            hideShadowCoveragePopup();
            renderer.domElement.style.cursor = 'auto';
        }
    }
});

function renderAxesHelper() {
    const originalViewport = new THREE.Vector4();
    renderer.getViewport(originalViewport);
    const originalScissor = new THREE.Vector4();
    renderer.getScissor(originalScissor);
    const originalScissorTest = renderer.getScissorTest();

    const left = axesPadding;
    const bottom = axesPadding;

    renderer.setViewport(left, bottom, axesCameraSize, axesCameraSize);
    renderer.setScissor(left, bottom, axesCameraSize, axesCameraSize);
    renderer.setScissorTest(true);

    axesCamera.lookAt(new THREE.Vector3(0,0,0));

    renderer.render(axesScene, axesCamera);

    renderer.setViewport(originalViewport.x, originalViewport.y, originalViewport.z, originalViewport.w);
    renderer.setScissor(originalScissor.x, originalScissor.y, originalScissor.z, originalScissor.w);
    renderer.setScissorTest(originalScissorTest);
}

function highlightAxis(axisName, direction) {
    resetAxisHighlight();
    const axisLine = getAxisLine(axisName);
    const highlightColor = new THREE.Color(0xffff00);
    const highlightLineWidth = 5;
    if (axisLine) {
        axisLine.material.color.copy(highlightColor);
        axisLine.material.linewidth = highlightLineWidth;
        axisLine.material.needsUpdate = true;
        startAxisPreview(axisName, direction);
    }
}

function resetAxisHighlight() {
    resetAllAxisLineMaterials();
    if (currentHoveredAxisPreviewTween) {
        currentHoveredAxisPreviewTween.stop();
        currentHoveredAxisPreviewTween = null;
    }
    customAxes.quaternion.copy(customAxesRotation);
}

function createTextSprite(message, color = '#000000', fontsize = 96) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    canvas.width = 256; 
    canvas.height = 128;
    
    context.font = `Bold ${fontsize}px Arial`;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    const metrics = context.measureText(message);
    const textWidth = metrics.width;
    const textHeight = fontsize;

    canvas.width = textWidth + 20; 
    canvas.height = textHeight + 20; 
    
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `Bold ${fontsize}px Arial`;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.renderOrder = 999;
    sprite.scale.set(canvas.width * 0.2, canvas.height * 0.2, 1); 
    return sprite;
}

function startAxisPreview(axis, direction) {
    if (currentHoveredAxisPreviewTween) {
        currentHoveredAxisPreviewTween.stop();
    }

    // Use the axes helper's current display quaternion as the starting point for the preview
    const startQuaternion = customAxes.quaternion.clone(); 
    const targetQuaternion = new THREE.Quaternion().copy(startQuaternion);
    const previewAngle = rotationAngle;
    const angle = direction === 'cw' ? -previewAngle : previewAngle;
    const rotationQuaternion = getAxisRotationQuaternion(axis, angle);
    targetQuaternion.multiply(rotationQuaternion);

    // Tween customAxes.quaternion directly for the temporary preview effect
    currentHoveredAxisPreviewTween = new TWEEN.Tween(customAxes.quaternion) 
        .to(targetQuaternion, 350)
        .easing(TWEEN.Easing.Quadratic.Out)
        .onUpdate(() => {})
        .start();
}

init();
