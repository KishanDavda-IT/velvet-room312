import * as THREE from 'three';
import { SEATS } from '../constants.js';

const COLOR_DEFAULT = 0x8c1c2c;
const COLOR_HOVER = 0xb02a3f;

export function buildSeats({ scene, camera, canvas, isSeatOccupied, onSelectSeat }) {
  const seatsRoot = new THREE.Group();
  seatsRoot.name = 'SeatsRoot';

  const baseGeo = new THREE.BoxGeometry(0.9, 0.5, 0.9);
  const backGeo = new THREE.BoxGeometry(0.9, 0.9, 0.15);

  const seatGroups = [];
  const seatMaterials = [];

  for (const seatDef of SEATS) {
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_DEFAULT,
      roughness: 0.85,
    });
    const group = new THREE.Group();
    group.position.set(...seatDef.pos);
    group.userData.seatIndex = seatDef.index;

    const baseMesh = new THREE.Mesh(baseGeo, mat);
    baseMesh.position.set(0, 0.25, 0);
    baseMesh.userData.seatIndex = seatDef.index;

    const backMesh = new THREE.Mesh(backGeo, mat);
    backMesh.position.set(0, 0.75, 0.4);
    backMesh.userData.seatIndex = seatDef.index;

    group.add(baseMesh, backMesh);
    seatsRoot.add(group);

    seatGroups.push(group);
    seatMaterials.push(mat);
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

    if (Math.hypot(dx, dy) >= 6) {
      return;
    }

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
      if (!interactive) {
        setHoveredSeat(null);
      }
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
      baseGeo.dispose();
      backGeo.dispose();
      seatMaterials.forEach((m) => m.dispose());
    },
  };
}
