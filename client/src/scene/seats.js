import * as THREE from 'three';
import { SEATS } from '../constants.js';

const COLOR_DEFAULT = 0x8c1c2c;
const COLOR_HOVER = 0xb02a3f;

export function buildSeats({ scene, camera, canvas, isSeatOccupied, onSelectSeat }) {
  const seatsRoot = new THREE.Group();
  seatsRoot.name = 'SeatsRoot';

  const seatGroups = [];
  const seatMaterials = [];
  const sharedGeometries = [];
  const allSeatMaterials = new Set();

  function makeBox(width, height, depth) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    sharedGeometries.push(geometry);
    return geometry;
  }

  for (const seatDef of SEATS) {
    const upholstery = new THREE.MeshStandardMaterial({
      color: COLOR_DEFAULT,
      roughness: 0.68,
      metalness: 0.02,
    });
    const piping = new THREE.MeshStandardMaterial({
      color: 0xc9a052,
      metalness: 0.36,
      roughness: 0.5,
    });
    const darkLeather = new THREE.MeshStandardMaterial({
      color: 0x50101b,
      roughness: 0.76,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x4c4544,
      metalness: 0.72,
      roughness: 0.3,
    });
    const fabric = new THREE.MeshStandardMaterial({
      color: 0xb94b58,
      roughness: 0.9,
    });
    for (const material of [upholstery, piping, darkLeather, metal, fabric]) {
      allSeatMaterials.add(material);
    }
    const group = new THREE.Group();
    group.position.set(...seatDef.pos);
    group.userData.seatIndex = seatDef.index;

    function part(geometry, material, x, y, z, rotation = null) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      if (rotation) mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.seatIndex = seatDef.index;
      group.add(mesh);
      return mesh;
    }

    // Padded blocky cinema chair with a sculpted back and separate cushions.
    part(makeBox(0.92, 0.42, 0.86), darkLeather, 0, 0.35, 0.02);
    part(makeBox(0.84, 0.34, 0.8), upholstery, 0, 0.48, -0.035);
    part(makeBox(0.95, 0.96, 0.2), darkLeather, 0, 0.9, 0.38);
    part(makeBox(0.84, 0.84, 0.16), upholstery, 0, 0.94, 0.26);

    // Upholstery seams and raised panels add visible detail at room distance.
    for (const x of [-0.24, 0, 0.24]) {
      part(makeBox(0.018, 0.66, 0.025), piping, x, 0.96, 0.174);
    }
    part(makeBox(0.58, 0.025, 0.024), fabric, 0, 1.22, 0.174);
    part(makeBox(0.58, 0.025, 0.024), fabric, 0, 0.69, 0.174);
    part(makeBox(0.78, 0.035, 0.04), piping, 0, 0.65, -0.07);

    // Arm pads with brass trim and sturdy, dark metal supports.
    for (const side of [-1, 1]) {
      const x = side * 0.51;
      part(makeBox(0.12, 0.13, 0.72), metal, x, 0.43, -0.02);
      part(makeBox(0.2, 0.17, 0.74), darkLeather, x, 0.57, -0.02);
      part(makeBox(0.18, 0.1, 0.68), upholstery, x, 0.66, -0.02);
      part(makeBox(0.19, 0.028, 0.69), piping, x, 0.715, -0.02);
      part(makeBox(0.08, 0.08, 0.72), metal, x, 0.21, 0.02);
    }

    // Four feet and a crossbar lift the chair off the floor.
    for (const x of [-0.37, 0.37]) {
      for (const z of [-0.31, 0.34]) {
        part(makeBox(0.075, 0.25, 0.075), metal, x, 0.13, z);
      }
    }
    part(makeBox(0.78, 0.055, 0.08), metal, 0, 0.11, 0.27);

    seatGroups.push(group);
    seatMaterials[seatDef.index] = upholstery;
    seatsRoot.add(group);
  }

  scene.add(seatsRoot);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downPos = null;
  let hoveredSeatIndex = null;
  let interactive = true;

  function setHoveredSeat(index) {
    if (hoveredSeatIndex === index) return;
    if (hoveredSeatIndex !== null && seatMaterials[hoveredSeatIndex]) {
      seatMaterials[hoveredSeatIndex].color.setHex(COLOR_DEFAULT);
    }
    hoveredSeatIndex = index;
    if (hoveredSeatIndex !== null && seatMaterials[hoveredSeatIndex]) {
      seatMaterials[hoveredSeatIndex].color.setHex(COLOR_HOVER);
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = '';
    }
  }

  function pickSeatIndex(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObjects(seatGroups, true);
    if (hits.length === 0) return null;
    const hitObj = hits[0].object;
    const idx = hitObj.userData.seatIndex ?? hitObj.parent?.userData?.seatIndex;
    return typeof idx === 'number' ? idx : null;
  }

  function onPointerDown(e) {
    if (!interactive) return;
    downPos = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e) {
    if (!interactive) {
      setHoveredSeat(null);
      return;
    }
    const idx = pickSeatIndex(e.clientX, e.clientY);
    if (idx !== null && !isSeatOccupied(idx)) {
      setHoveredSeat(idx);
    } else {
      setHoveredSeat(null);
    }
  }

  function onPointerUp(e) {
    if (!interactive || !downPos) return;
    const dx = e.clientX - downPos.x;
    const dy = e.clientY - downPos.y;
    downPos = null;

    if (Math.hypot(dx, dy) >= 6) return;

    const idx = pickSeatIndex(e.clientX, e.clientY);
    if (idx !== null && !isSeatOccupied(idx)) {
      onSelectSeat(idx);
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  return {
    seatsRoot,
    setInteractive(enabled) {
      interactive = Boolean(enabled);
      if (!interactive) setHoveredSeat(null);
    },
    refreshHover() {
      if (hoveredSeatIndex !== null && isSeatOccupied(hoveredSeatIndex)) {
        setHoveredSeat(null);
      }
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      sharedGeometries.forEach((geometry) => geometry.dispose());
      allSeatMaterials.forEach((material) => material.dispose());
    },
  };
}
