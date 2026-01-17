// =========================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// =========================================================

// Переменные для Мыши (Parallax)
let mouseX = 0;
let mouseY = 0;
const parallaxInfluence = 0.5; // Насколько сильно камера реагирует на курсор

// Переменные для Скролла
let isAnimating = false; 
let currentSection = 0;
let cameraPositions = []; // Позиции и ротации камер GLTF


// =========================================================
// ШАГ 1: ИНИЦИАЛИЗАЦИЯ И РЕНДЕРЕР
// =========================================================

const scene = new THREE.Scene(); 
const renderer = new THREE.WebGLRenderer({ antialias: true }); 
renderer.setSize(window.innerWidth, window.innerHeight); 
document.body.appendChild(renderer.domElement);
renderer.physicallyCorrectLights = true;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000); 
activeCamera = camera;


// =========================================================
// ШАГ 2: ОСВЕЩЕНИЕ (РУЧНОЕ + HDRI)
// =========================================================

const sunLight = new THREE.DirectionalLight(0xffffff, 20); 
sunLight.position.set(50, 100, 50); 
scene.add(sunLight);
const ambientLight = new THREE.AmbientLight(0xffffff, 5); 
scene.add(ambientLight);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
new THREE.RGBELoader()
    .load('assets/809-hdri-skies-com.hdr', function (texture) {
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap; 
        scene.background = new THREE.Color(0x000000); 
        pmremGenerator.dispose();
    });


// =========================================================
// ШАГ 3: ЗАГРУЗКА МОДЕЛИ И ПОЗИЦИЙ КАМЕР
// =========================================================

const loader = new THREE.GLTFLoader();
const modelPath = 'models/miromar_map_draft.gltf'; 

loader.load(modelPath, function (gltf) {
    const model = gltf.scene;
    
    // --- Сохраняем позиции и ротации всех камер ---
    gltf.cameras.forEach(cam => {
        cam.updateWorldMatrix(true, false);
        
        cameraPositions.push({
            position: new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), // Мировая позиция
            rotation: cam.rotation.clone() // Ротация
        });
    });

    if (cameraPositions.length >= 1) {
        // Устанавливаем камеру в позицию первой секции
        camera.position.copy(cameraPositions[0].position);
        camera.rotation.copy(cameraPositions[0].rotation);
    } else {
        camera.position.set(200, 200, 200);
        camera.lookAt(0, 0, 0); // Если камер нет, смотрим в центр
    }

    // --- Настройки модели ---
    model.scale.set(100, 100, 100); 
    model.position.set(0, 0, 0); 
    scene.add(model);
    
    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true; 
            child.receiveShadow = true;
            if (child.material.isMeshStandardMaterial) {
                child.material.envMapIntensity = 1; 
            }
        }
    });
    console.log(`Найдено ${cameraPositions.length} секций.`);
});


// =========================================================
// ШАГ 4: ЛОГИКА ПЕРЕКЛЮЧЕНИЯ ПО СКРОЛЛУ
// =========================================================

function goToSection(index) {
    if (isAnimating || index < 0 || index >= cameraPositions.length || index === currentSection) return;

    isAnimating = true;
    const target = cameraPositions[index];
    const duration = 2.5;

    // Анимация позиции 
    gsap.to(camera.position, {
        duration: duration,
        x: target.position.x,
        y: target.position.y,
        z: target.position.z,
        ease: "power2.inOut",
    });

    // Анимация поворота
    gsap.to(camera.rotation, {
        duration: duration,
        x: target.rotation.x,
        y: target.rotation.y,
        z: target.rotation.z,
        ease: "power2.inOut",
        onComplete: () => {
            isAnimating = false;
            currentSection = index;
            camera.rotation.copy(target.rotation);
        }
    });
}

window.addEventListener('wheel', (event) => {
    if (isAnimating || cameraPositions.length < 2) return; 

    let newIndex = currentSection;

    if (event.deltaY > 0) {
        newIndex = Math.min(currentSection + 1, cameraPositions.length - 1);
    } else if (event.deltaY < 0) {
        newIndex = Math.max(currentSection - 1, 0);
    }

    goToSection(newIndex);
}, { passive: false });


// =========================================================
// ШАГ 5: АНИМАЦИОННЫЙ ЦИКЛ (RENDER LOOP)
// =========================================================

function animate() {
    requestAnimationFrame(animate); 

    // --- Эффект Parallax (Только для первой камеры) ---
    if (!isAnimating && currentSection === 0 && cameraPositions.length > 0) {
        
        // Берем исходную позицию первой камеры
        const targetPosition = cameraPositions[0].position; 

        // Вычисляем, насколько нужно СМЕСТИТЬ камеру относительно ее исходной позиции
        const offsetX = mouseX * parallaxInfluence;
        const offsetY = mouseY * parallaxInfluence;
        
        // Применяем смещение
        camera.position.x = targetPosition.x + offsetX;
        camera.position.y = targetPosition.y + offsetY;
        
        // ВАЖНО: Ротация остается исходной (как в GLTF)
        camera.rotation.copy(cameraPositions[0].rotation);
    }
    
    renderer.render(scene, camera);
}

animate();


// =========================================================
// ШАГ 6: ОБРАБОТКА МЫШИ И РЕСАЙЗ
// =========================================================

window.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix(); 
    renderer.setSize(window.innerWidth, window.innerHeight);
});