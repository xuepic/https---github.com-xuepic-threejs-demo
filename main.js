import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Water } from 'three/addons/objects/Water.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// --- Константы ---
const GLB_PATH = './assets/miromar_3d.glb';
const HDRI_PATH = './assets/809-hdri-skies-com.hdr';
const WATER_NORMALS_PATH = './assets/waternormals.jpg';

const SCALE_FACTOR = 100.0; 
const TARGET_POINT = new THREE.Vector3(0, 0, 0); 
const SCROLL_ANIMATION_DISTANCE = 3000; 

const cameraFOV = 50; 
let animationActions = []; 
let animationDuration = 0; 

// --- Переменные для скролл-анимации ---
let cameraStartProgramPos = new THREE.Vector3(); 
let cameraStartProgramQuat = new THREE.Quaternion(); 
let cameraOrbitEndPos = new THREE.Vector3(); 
let cameraOrbitEndQuat = new THREE.Quaternion(); 

// --- Основные переменные сцены ---
let scene, renderer, clock, mixer = null;
let rootGroup; 
let activeCamera;
let controls = null;
let water = null;


// --- 1. Инициализация и Загрузка Окружения ---

function init() {
    scene = new THREE.Scene();
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    document.getElementById('threejs-container').appendChild(renderer.domElement);

    clock = new THREE.Clock();
    
    loadEnvironment();
    loadModel();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('scroll', handleScroll); 
    
    animate(); 
}

function loadEnvironment() {
    new RGBELoader()
        .setDataType(THREE.FloatType)
        .load(HDRI_PATH, (texture) => {
            const pmremGenerator = new THREE.PMREMGenerator(renderer);
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            
            scene.environment = envMap; 
            scene.background = new THREE.Color(0x1C1815); 
            texture.dispose();
            pmremGenerator.dispose();
        });
}


// --- 2. Scroll-Driven Animation Logic ---

function handleScroll() {
    requestAnimationFrame(updateScrollAnimation);
}

function updateScrollAnimation() {
    const scrollY = window.scrollY;
    // Прогресс скролла (от 0 до 1)
    const scrollProgress = Math.min(1, Math.max(0, scrollY / SCROLL_ANIMATION_DISTANCE));

    if (activeCamera && cameraStartProgramPos.length() > 0) {
        
        // 1. Анимация Камеры (Переход от START_CAMERA к END_CAMERA)
        activeCamera.position.copy(cameraStartProgramPos).lerp(cameraOrbitEndPos, scrollProgress);
        activeCamera.quaternion.copy(cameraStartProgramQuat).slerp(cameraOrbitEndQuat, scrollProgress);
        
        // 2. Анимация Комплекса
        if (mixer && animationActions.length > 0) {
            const time = scrollProgress * animationDuration;
            mixer.setTime(time);
        }
        
        // 3. Активация OrbitControls
        if (scrollProgress >= 1 && controls && !controls.enabled) {
            controls.enabled = true;
        }
    }
    
    if (controls) controls.update(); 
}


// --- 3. Загрузка GLB и Настройка Сцены ---

function loadModel() {
    const loader = new GLTFLoader();

    loader.load(GLB_PATH, (gltf) => {
        rootGroup = gltf.scene;
        
        // 1. Масштабирование
        rootGroup.scale.set(SCALE_FACTOR, SCALE_FACTOR, SCALE_FACTOR);
        scene.add(rootGroup);

        const cameraStartNode = rootGroup.getObjectByName('START_CAMERA'); 
        const cameraEndNode = rootGroup.getObjectByName('END_CAMERA'); 
        const seaMesh = rootGroup.getObjectByName('Sea');
        
        // 2. Инициализация ActiveCamera (Старт с START_CAMERA)
        
        if (cameraStartNode && cameraEndNode) {
            const exportedCameraComponent = cameraStartNode.children.find(c => c.isCamera);
            
            activeCamera = new THREE.PerspectiveCamera(
                cameraFOV, 
                window.innerWidth / window.innerHeight,
                exportedCameraComponent ? exportedCameraComponent.near : 0.1,
                exportedCameraComponent ? exportedCameraComponent.far : 3000
            );

            // A) СТАРТОВАЯ ПОЗИЦИЯ (из START_CAMERA)
            cameraStartProgramPos.copy(cameraStartNode.position).multiplyScalar(SCALE_FACTOR);
            cameraStartProgramQuat.copy(cameraStartNode.quaternion);
            
            // B) ЦЕЛЕВАЯ ПОЗИЦИЯ (из END_CAMERA)
            cameraOrbitEndPos.copy(cameraEndNode.position).multiplyScalar(SCALE_FACTOR);
            cameraOrbitEndQuat.copy(cameraEndNode.quaternion);
            
            // Установка камеры в начальную позицию
            activeCamera.position.copy(cameraStartProgramPos);
            activeCamera.quaternion.copy(cameraStartProgramQuat);

            cameraStartNode.parent.remove(cameraStartNode); 
            cameraEndNode.parent.remove(cameraEndNode); 
            scene.add(activeCamera);
            
        } else {
            console.error("Критическая ошибка: Камеры START_CAMERA или END_CAMERA не найдены.");
            activeCamera = new THREE.PerspectiveCamera(cameraFOV, window.innerWidth / window.innerHeight, 0.1, 3000);
            activeCamera.position.set(20 * SCALE_FACTOR, 5 * SCALE_FACTOR, 20 * SCALE_FACTOR); 
        }

        activeCamera.aspect = window.innerWidth / window.innerHeight;
        activeCamera.updateProjectionMatrix();

        // 3. Настройка OrbitControls
        controls = new OrbitControls(activeCamera, renderer.domElement);
        controls.target.copy(TARGET_POINT).multiplyScalar(SCALE_FACTOR); 
        controls.enableDamping = true;
        controls.enabled = false; 
        controls.update();
        
        // 4. Обработка Анимации Комплекса (Синхронизация скроллом)
        if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(rootGroup); 
            
            gltf.animations.forEach(clip => {
                const action = mixer.clipAction(clip);
                if (!clip.name.includes('CAMERA')) { 
                    action.setEffectiveWeight(1.0); 
                    action.enabled = true; 
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    action.play(); 
                    action.paused = true; // СТАРТ НА ПАУЗЕ
                    
                    animationActions.push(action);
                    animationDuration = Math.max(animationDuration, clip.duration);
                }
            });
            mixer.setTime(0);
        }

        // 5. Динамическая Вода
        if (seaMesh) {
            setupDynamicWater(seaMesh);
        }

    }, (xhr) => {
        // ... (прогресс) ...
    }, (error) => {
        console.error('Ошибка загрузки GLB:', error);
    });
}


// --- 4. Настройка Динамической Воды ---
function setupDynamicWater(seaMesh) {
    const waterWorldPosition = new THREE.Vector3();
    seaMesh.getWorldPosition(waterWorldPosition);
    seaMesh.parent.remove(seaMesh); 

    const waterSize = 10 * SCALE_FACTOR; 
    const waterGeometry = new THREE.PlaneGeometry(waterSize, waterSize); 

    water = new Water(
        waterGeometry,
        {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: new THREE.TextureLoader().load(WATER_NORMALS_PATH, function (texture) {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            }),
            sunDirection: new THREE.Vector3(0.5, 1.0, 0.5).normalize(),
            waterColor: 0x00457d, 
            distortionScale: 3.0,
            size: 0.5 * SCALE_FACTOR 
        }
    );
    
    water.rotation.x = - Math.PI / 2;
    water.position.copy(waterWorldPosition);
    
    scene.add(water);
}


// --- 5. Цикл Рендера ---

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (mixer) { 
        mixer.update(0); 
    }
    
    if (water) {
        water.material.uniforms['time'].value += delta * 0.5;
    }

    if (controls) { 
        controls.update();
    }

    if (activeCamera) {
        renderer.render(scene, activeCamera);
    }
}


function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (activeCamera) {
        activeCamera.aspect = window.innerWidth / window.innerHeight;
        activeCamera.updateProjectionMatrix();
    }
}


document.addEventListener('DOMContentLoaded', init);