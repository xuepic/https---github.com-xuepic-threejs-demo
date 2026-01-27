import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Water } from 'three/addons/objects/Water.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as TWEEN from 'tween'; 

// --- Константы ---
const GLB_PATH = './assets/miromar_3d.glb';
const HDRI_PATH = './assets/809-hdri-skies-com.hdr';
const WATER_NORMALS_PATH = './assets/waternormals.jpg';

const SCALE_FACTOR = 100.0;
const TARGET_POINT = new THREE.Vector3(0, 0, 0); 
const TARGET_POINT_SCALED = TARGET_POINT.clone().multiplyScalar(SCALE_FACTOR);

// Параметры анимации
let SCROLL_TRIGGER_THRESHOLD = 0; 
const TRANSITION_TWEEN_DURATION = 1500; // Увеличен для кинематографичности
const ANIMATION_START_DELAY = 1.0; 

const cameraFOV = 50;

// --- Переменные для Динамики/Параллакса (Смещение LookAt) ---
let mouseX = 0;
let mouseY = 0;
const MAX_PARALLAX_OFFSET = 3.0; // Уменьшено смещение
const PARALLAX_LERP_FACTOR = 0.05; // Сглаживание движения LookAt
let currentLookAtTarget = TARGET_POINT_SCALED.clone(); 


// --- Переменные для скролл-анимации ---
let cameraStartProgramPos = new THREE.Vector3();
let cameraEndProgramPos = new THREE.Vector3();
let cameraStartQuaternion = new THREE.Quaternion(); 
let cameraEndQuaternion = new THREE.Quaternion(); 

let visualProgress = 0; 
let currentScrollTween = null; 
let isAnimationLocked = false; 

// --- Основные переменные сцены ---
let scene, renderer, clock, mixer = null;
let rootGroup;
let activeCamera;
let water = null;
let sunLight = null; // Для теней и настройки воды


function init() {
    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // --- УЛУЧШЕНИЕ РЕНДЕРИНГА 1: Физически корректные настройки ---
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1; // Увеличиваем экспозицию для яркости
    
    renderer.useLegacyLights = false; 

    // --- УЛУЧШЕНИЕ РЕНДЕРИНГА 2: Настройка теней ---
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 

    document.getElementById('threejs-container').appendChild(renderer.domElement);

    clock = new THREE.Clock();
    
    onWindowResize(); 

    loadEnvironment();
    loadModel();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('scroll', handleScroll); 
    document.addEventListener('mousemove', onMouseMove); 

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
        
        // Амбиентный свет используется для смягчения самых глубоких теней
        scene.add(new THREE.AmbientLight(0xffffff, 0.1));
        
        // --- Настройка Directional Light для теней ---
        sunLight = new THREE.DirectionalLight(0xffffff, 0.5); // Высокая интенсивность
        sunLight.castShadow = true;
        
        // Настройка параметров теневой камеры (охват сцены)
        const d = 50 * SCALE_FACTOR; 
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;
        
        // Настройка глубины видимости теней
        sunLight.shadow.camera.near = 1 * SCALE_FACTOR; 
        sunLight.shadow.camera.far = 100 * SCALE_FACTOR; 
        
        // Высокое разрешение для качественных теней
        sunLight.shadow.mapSize.width = 4096; 
        sunLight.shadow.mapSize.height = 4096;
        
        // Сглаживание артефактов теней при большом масштабе
        sunLight.shadow.bias = -0.0005; 
        
        scene.add(sunLight);
    });
}

function onMouseMove(event) {
    // mouseX/Y от -1 до 1
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
}

// --- Scroll Logic ---

function handleScroll() {
    const scrollY = window.scrollY;
    
    let desiredProgress = 0;
    
    if (scrollY >= SCROLL_TRIGGER_THRESHOLD) {
        desiredProgress = 1;
    } 
    
    if (scrollY < SCROLL_TRIGGER_THRESHOLD / 2 && visualProgress === 1) {
        desiredProgress = 0;
    }
    
    if (visualProgress === desiredProgress || isAnimationLocked) {
        return;
    }

    isAnimationLocked = true;
    
    if (currentScrollTween) {
        currentScrollTween.stop();
    }
    
    currentScrollTween = new TWEEN.Tween({ progress: visualProgress })
        .to({ progress: desiredProgress }, TRANSITION_TWEEN_DURATION) 
        .easing(TWEEN.Easing.Cubic.InOut) 
        .onUpdate(obj => {
            visualProgress = obj.progress;
            updateCameraPosition(visualProgress); 
        })
        .onComplete(() => {
            currentScrollTween = null;
            isAnimationLocked = false;
        })
        .start();
}


/**
 * Обновляет позицию камеры (LERP Position) и вращение (Smoothed LookAt Parallax).
 */
function updateCameraPosition(progress) {
    
    if (!activeCamera || cameraStartProgramPos.length() === 0) return;
        
    // 1. Анимация Позиции Камеры (LERP)
    activeCamera.position.copy(cameraStartProgramPos).lerp(cameraEndProgramPos, progress);

    // 2. Расчет силы Parallax (Смещение LookAt)
    const parallaxFactor = THREE.MathUtils.lerp(1.0, 0.1, progress); 
    const currentOffset = MAX_PARALLAX_OFFSET * parallaxFactor;
    
    const desiredParallaxOffset = new THREE.Vector3(
        mouseX * currentOffset,
        mouseY * currentOffset,
        0 
    );

    // 3. Плавность движения курсора (LookAt)
    currentLookAtTarget.lerp(desiredParallaxOffset, PARALLAX_LERP_FACTOR); 

    // 4. Установка вращения LookAt
    const lookAtTargetPosition = TARGET_POINT_SCALED.clone().add(currentLookAtTarget);
    activeCamera.lookAt(lookAtTargetPosition);
}


// --- Загрузка GLB и Настройка Сцены ---

function loadModel() {
    const loader = new GLTFLoader();

    loader.load(GLB_PATH, (gltf) => {
        rootGroup = gltf.scene;
        
        if (!rootGroup) return; 

        rootGroup.scale.set(SCALE_FACTOR, SCALE_FACTOR, SCALE_FACTOR);
        scene.add(rootGroup);
        
        let cameraStartNode = null; 
        let cameraEndNode = null;
        
        rootGroup.traverse((node) => {
            
            // Включение теней для всей геометрии
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
            
            // Настройка Directional Light
            if (node.name === 'Sun' && sunLight) {
                // Копируем вращение, чтобы свет падал в направлении Blender Sun
                node.getWorldQuaternion(sunLight.quaternion);
                sunLight.rotation.setFromQuaternion(sunLight.quaternion);
                
                // Размещаем свет далеко, чтобы лучи были параллельны
                sunLight.position.set(0, 1000 * SCALE_FACTOR, 0); 
                sunLight.translateZ(-500 * SCALE_FACTOR); 
            }

            if (node.name === 'START_CAMERA') cameraStartNode = node;
            if (node.name === 'END_CAMERA') cameraEndNode = node;
        });

        
        if (cameraStartNode && cameraEndNode) {
            const exportedCameraComponent = cameraStartNode.children.find(c => c.isCamera);
            
            // Масштабируем near/far камеры
            activeCamera = new THREE.PerspectiveCamera(
                cameraFOV, 
                window.innerWidth / window.innerHeight,
                exportedCameraComponent ? exportedCameraComponent.near * SCALE_FACTOR : 0.1,
                exportedCameraComponent ? exportedCameraComponent.far * SCALE_FACTOR : 3000
            );

            cameraStartProgramPos.copy(cameraStartNode.position).multiplyScalar(SCALE_FACTOR);
            cameraEndProgramPos.copy(cameraEndNode.position).multiplyScalar(SCALE_FACTOR);
            cameraStartQuaternion.copy(cameraStartNode.quaternion);
            cameraEndQuaternion.copy(cameraEndNode.quaternion); 
            
            activeCamera.position.copy(cameraStartProgramPos);
            activeCamera.lookAt(TARGET_POINT_SCALED); 

            cameraStartNode.parent.remove(cameraStartNode); 
            cameraEndNode.parent.remove(cameraEndNode); 
            scene.add(activeCamera);
            
        } else {
            console.error("Критическая ошибка: Камеры START_CAMERA или END_CAMERA не найдены.");
            activeCamera = new THREE.PerspectiveCamera(cameraFOV, window.innerWidth / window.innerHeight, 0.1, 3000 * SCALE_FACTOR);
            activeCamera.position.set(20 * SCALE_FACTOR, 5 * SCALE_FACTOR, 20 * SCALE_FACTOR); 
            activeCamera.lookAt(TARGET_POINT_SCALED); 
            scene.add(activeCamera);
        }

        activeCamera.aspect = window.innerWidth / window.innerHeight;
        activeCamera.updateProjectionMatrix();
        
        // АНИМАЦИЯ КОМПЛЕКСА (Волны)
        if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(rootGroup); 
            
            gltf.animations.forEach(clip => {
                const action = mixer.clipAction(clip);
                if (!clip.name.includes('CAMERA')) { 
                    action.setEffectiveWeight(1.0); 
                    action.enabled = true; 
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    
                    setTimeout(() => {
                        action.play();
                    }, ANIMATION_START_DELAY * 1000); 
                }
            });
        }

        const seaMesh = rootGroup.getObjectByName('Sea'); 
        if (seaMesh) {
            setupDynamicWater(seaMesh);
        }

        updateCameraPosition(visualProgress); 

    }, (xhr) => {
        console.log( 'GLB progress:', ( xhr.loaded / xhr.total * 100 ) + '% loaded' );
    }, (error) => {
        console.error('Ошибка загрузки GLB:', error);
    });
}

// --- Настройка Динамической Воды ---
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
            // Используем направление основного света
            sunDirection: sunLight.position.clone().normalize(), 
            sunColor: 0xffffff,
            waterColor: 0x002e5c, // Глубокий синий
            
            distortionScale: 1.5, // Уменьшенное искажение для спокойной воды
            size: 5.0, // Визуальный размер волн
            
            alpha: 0.9, 
            side: THREE.DoubleSide
        }
    );

    water.rotation.x = - Math.PI / 2;
    water.position.copy(waterWorldPosition);
    water.receiveShadow = true; 

    scene.add(water);
}

// --- Цикл Рендера ---

function animate(time) {
    requestAnimationFrame(animate);

    TWEEN.update(time); 

    const delta = clock.getDelta();

    if (mixer) { 
        mixer.update(delta); 
    }

    if (water) {
        // Замедлим скорость волн
        water.material.uniforms['time'].value += delta * 0.2;
    }
    
    // Обновляем позицию для Parallax LERP
    updateCameraPosition(visualProgress); 
    
    if (activeCamera) {
        renderer.render(scene, activeCamera);
    }
}

function onWindowResize() {
    SCROLL_TRIGGER_THRESHOLD = window.innerHeight / 2;

    renderer.setSize(window.innerWidth, window.innerHeight);
    if (activeCamera) {
        activeCamera.aspect = window.innerWidth / window.innerHeight;
        activeCamera.updateProjectionMatrix();
    }
}

document.addEventListener('DOMContentLoaded', init);