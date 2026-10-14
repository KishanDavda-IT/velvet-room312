import * as THREE from 'three';

const COMPANION_COLORS = [0xd97998, 0x8b75d7, 0x4ea99b, 0xe3a454];

export function buildCompanion({ scene, getPlayerPosition }) {
  const root = new THREE.Group();
  root.name = 'CompanionRoot';
  root.visible = false;
  scene.add(root);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd97998, roughness: 0.82 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c4a2, roughness: 0.86 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x38233e, roughness: 0.92 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x302b4d, roughness: 0.9 });
  const faceMat = new THREE.MeshStandardMaterial({ color: 0x342534, roughness: 0.84 });
  const parts = [];

  function block(width, height, depth, material, x, y, z, parent = root) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    parts.push(mesh);
    return mesh;
  }

  block(0.62, 0.62, 0.36, bodyMat, 0, 1.04, 0);
  block(0.52, 0.52, 0.52, skinMat, 0, 1.7, 0);
  block(0.58, 0.2, 0.58, hairMat, 0, 2.04, 0.01);
  block(0.12, 0.38, 0.5, hairMat, -0.25, 1.82, 0.08);
  block(0.12, 0.38, 0.5, hairMat, 0.25, 1.82, 0.08);
  block(0.07, 0.08, 0.025, faceMat, -0.12, 1.72, -0.27);
  block(0.07, 0.08, 0.025, faceMat, 0.12, 1.72, -0.27);
  block(0.15, 0.025, 0.025, faceMat, 0, 1.56, -0.27);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.38, 1.28, 0);
  root.add(leftArm);
  block(0.25, 0.58, 0.29, bodyMat, 0, -0.24, 0, leftArm);
  const rightArm = new THREE.Group();
  rightArm.position.set(0.38, 1.28, 0);
  root.add(rightArm);
  block(0.25, 0.58, 0.29, bodyMat, 0, -0.24, 0, rightArm);

  // Seated legs extend forward from the chair.
  block(0.26, 0.22, 0.58, pantsMat, -0.18, 0.68, -0.28);
  block(0.26, 0.22, 0.58, pantsMat, 0.18, 0.68, -0.28);
  block(0.28, 0.16, 0.34, pantsMat, -0.18, 0.57, -0.71);
  block(0.28, 0.16, 0.34, pantsMat, 0.18, 0.57, -0.71);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 24),
    new THREE.MeshBasicMaterial({ color: 0x050308, transparent: true, opacity: 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  root.add(shadow);
  parts.push(shadow);

  let visible = false;
  let idlePhase = 0;
  let colorIndex = 0;

  function setVisible(next) {
    visible = Boolean(next);
    root.visible = visible;
    if (visible) {
      const player = getPlayerPosition();
      if (player) {
        // Keep the seated friend to the player's right, using the player's facing direction.
        const side = 1.12;
        root.position.set(
          player.x + Math.cos(player.yaw || 0) * side,
          player.y,
          player.z - Math.sin(player.yaw || 0) * side
        );
        root.rotation.y = player.yaw || 0;
      }
      root.userData.bob = 0;
      idlePhase = 0;
      bodyMat.color.setHex(COMPANION_COLORS[colorIndex % COMPANION_COLORS.length]);
      colorIndex += 1;
    }
    return visible;
  }

  function update(dt) {
    if (!visible) return;
    idlePhase += dt;
    root.position.y += (Math.sin(idlePhase * 1.8) * 0.018 - (root.userData.bob || 0));
    root.userData.bob = Math.sin(idlePhase * 1.8) * 0.018;
  }

  return {
    setVisible,
    toggle() { return setVisible(!visible); },
    isVisible() { return visible; },
    update,
    dispose() {
      scene.remove(root);
      parts.forEach((part) => part.geometry.dispose());
      [bodyMat, skinMat, hairMat, pantsMat, faceMat, shadow.material].forEach((material) => material.dispose());
    },
  };
}
