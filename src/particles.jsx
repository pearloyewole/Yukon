import * as THREE from 'three';

// Particle system for river flow visualization

let particleSystem = null;
let velocityData = null;

export function buildParticleSystem(velSlices, maskSlices, sliceWidths, sliceHeight, scene, config) {
  const { DOWNSAMPLE, SLICE_SPACING, colorForVelocity, downsampleGrid } = config;
  
  // Store velocity data for interpolation
  velocityData = {
    slices: velSlices.map(v => downsampleGrid(v, DOWNSAMPLE)),
    masks: maskSlices.map(m => downsampleGrid(m, DOWNSAMPLE)),
    sliceWidths: sliceWidths, // Array of widths for each slice
    sliceHeight,
    sliceCenterY: 5,
    sliceSpacing: SLICE_SPACING,
    numSlices: velSlices.length
  };

  const particleCount = 3000; // More particles for water-like flow
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount); // Store speed for each particle

  // Initialize particles randomly in water areas
  for (let i = 0; i < particleCount; i++) {
    let placed = false;
    let attempts = 0;
    
    while (!placed && attempts < 50) {
      // Random slice
      const sliceIdx = Math.floor(Math.random() * velSlices.length);
      const velGrid = velocityData.slices[sliceIdx];
      const maskGrid = velocityData.masks[sliceIdx];
      
      if (!velGrid.length || !maskGrid.length) {
        attempts++;
        continue;
      }
      
      const rows = velGrid.length;
      const cols = velGrid[0].length;
      
      // Random position in slice
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      
      // Check if it's water
      if (maskGrid[r] && maskGrid[r][c] > 0.5 && Number.isFinite(velGrid[r][c])) {
        const x = (sliceIdx - velSlices.length / 2) * SLICE_SPACING;
        // Match cross-section coordinate system: yFrac = (rows - 1 - r) / (rows - 1)
        const yFrac = (rows - 1 - r) / (rows - 1);
        const y = velocityData.sliceCenterY + (yFrac - 0.5) * sliceHeight;
        const zFrac = c / (cols - 1);
        // Match cross-section: negate Z to match coordinate transformation
        // Use the actual width for this slice
        const sliceWidth = sliceWidths[sliceIdx];
        const z = -((zFrac - 0.5) * sliceWidth);
        
        const vel = velGrid[r][c];
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        velocities[i] = vel;
        
        // Color based on velocity - water-like colors (more blue/cyan tint)
        const globalMin = Math.min(...velSlices.flat().flat().filter(v => Number.isFinite(v)));
        const globalMax = Math.max(...velSlices.flat().flat().filter(v => Number.isFinite(v)));
        const color = colorForVelocity(vel, globalMin, globalMax);
        // Add water-like tint - blend with cyan/blue for water appearance
        const waterTint = new THREE.Color(0x4da6ff); // Light blue water tint
        color.lerp(waterTint, 0.3); // Blend 30% water tint
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        
        placed = true;
      }
      attempts++;
    }
    
    // If couldn't place, put at default position
    if (!placed) {
      const sliceIdx = Math.floor(velSlices.length / 2);
      positions[i * 3] = (sliceIdx - velSlices.length / 2) * SLICE_SPACING;
      positions[i * 3 + 1] = velocityData.sliceCenterY;
      positions[i * 3 + 2] = 0;
      velocities[i] = 0;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.userData.velocities = velocities;

  // Water-like material - more transparent and fluid-looking
  const material = new THREE.PointsMaterial({
    size: 2.5, // Slightly smaller for more water-like appearance
    vertexColors: true,
    transparent: true,
    opacity: 0.7, // More transparent like water
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending, // Creates a glowing water effect
    depthWrite: false, // Better for transparent water particles
  });

  particleSystem = new THREE.Points(geometry, material);
  particleSystem.renderOrder = 10; // Render on top
  scene.add(particleSystem);
  
  // Debug: count how many particles were actually placed
  let placedCount = 0;
  for (let i = 0; i < particleCount; i++) {
    if (positions[i * 3 + 1] !== velocityData.sliceCenterY || positions[i * 3 + 2] !== 0) {
      placedCount++;
    }
  }
  console.log(`Created particle system: ${placedCount} particles placed in water, ${particleCount - placedCount} at default position`);
}

export function updateParticles(dt, colorForVelocity) {
  if (!particleSystem || !velocityData) return;

  const positions = particleSystem.geometry.attributes.position;
  const velocities = particleSystem.geometry.userData.velocities;
  const numParticles = positions.count;

  for (let i = 0; i < numParticles; i++) {
    let x = positions.getX(i);
    let y = positions.getY(i);
    let z = positions.getZ(i);
    
    // Find which slice we're in or between
    const sliceIdx = Math.floor((x + (velocityData.numSlices / 2) * velocityData.sliceSpacing) / velocityData.sliceSpacing);
    const sliceIdx0 = Math.max(0, Math.min(velocityData.numSlices - 1, sliceIdx));
    const sliceIdx1 = Math.max(0, Math.min(velocityData.numSlices - 1, sliceIdx + 1));
    
    // Interpolate velocity between slices
    const t = ((x - (sliceIdx0 - velocityData.numSlices / 2) * velocityData.sliceSpacing) / velocityData.sliceSpacing);
    const tClamped = Math.max(0, Math.min(1, t));
    
    // Get velocity at current position in both slices
    const vel0 = getVelocityAtPosition(x, y, z, sliceIdx0);
    const vel1 = getVelocityAtPosition(x, y, z, sliceIdx1);
    const vel = vel0 * (1 - tClamped) + vel1 * tClamped;
    
    if (vel > 0 && Number.isFinite(vel)) {
      // Move particle forward based on velocity - smooth water-like flow
      // Use a scale factor that makes movement visible but smooth
      const speed = vel * 1.5; // Smooth water flow speed
      x += speed * dt;
      
      // Add slight vertical variation for more natural water movement
      const waveOffset = Math.sin(x * 0.1 + performance.now() * 0.001) * 0.1;
      y += waveOffset * dt;
      
      // Wrap around if past the end
      const maxX = (velocityData.numSlices - 1 - velocityData.numSlices / 2) * velocityData.sliceSpacing + 20;
      if (x > maxX) {
        x = -(velocityData.numSlices / 2) * velocityData.sliceSpacing - 20;
        // Respawn at random position
        const newSliceIdx = Math.floor(Math.random() * velocityData.numSlices);
        const velGrid = velocityData.slices[newSliceIdx];
        const maskGrid = velocityData.masks[newSliceIdx];
        if (velGrid.length && maskGrid.length) {
          const rows = velGrid.length;
          const cols = velGrid[0].length;
          const r = Math.floor(Math.random() * rows);
          const c = Math.floor(Math.random() * cols);
          if (maskGrid[r] && maskGrid[r][c] > 0.5) {
            x = (newSliceIdx - velocityData.numSlices / 2) * velocityData.sliceSpacing;
            // Match cross-section coordinate system
            const yFrac = (rows - 1 - r) / (rows - 1);
            y = velocityData.sliceCenterY + (yFrac - 0.5) * velocityData.sliceHeight;
            const zFrac = c / (cols - 1);
            // Use the actual width for this slice
            const sliceWidth = velocityData.sliceWidths[newSliceIdx];
            z = -((zFrac - 0.5) * sliceWidth);
            velocities[i] = velGrid[r][c];
            
            // Update color based on new velocity - with water tint
            const globalMin = Math.min(...velocityData.slices.flat().flat().filter(v => Number.isFinite(v)));
            const globalMax = Math.max(...velocityData.slices.flat().flat().filter(v => Number.isFinite(v)));
            const color = colorForVelocity(velocities[i], globalMin, globalMax);
            const waterTint = new THREE.Color(0x4da6ff);
            color.lerp(waterTint, 0.3);
            const colors = particleSystem.geometry.attributes.color;
            colors.setXYZ(i, color.r, color.g, color.b);
          }
        }
      }
      
      positions.setX(i, x);
      positions.setY(i, y);
      positions.setZ(i, z);
      
      // Update stored velocity for this particle
      velocities[i] = vel;
      
      // Update color based on current velocity - with water tint
      const globalMin = Math.min(...velocityData.slices.flat().flat().filter(v => Number.isFinite(v)));
      const globalMax = Math.max(...velocityData.slices.flat().flat().filter(v => Number.isFinite(v)));
      const color = colorForVelocity(vel, globalMin, globalMax);
      const waterTint = new THREE.Color(0x4da6ff);
      color.lerp(waterTint, 0.3);
      const colors = particleSystem.geometry.attributes.color;
      colors.setXYZ(i, color.r, color.g, color.b);
    }
  }

  positions.needsUpdate = true;
  particleSystem.geometry.attributes.color.needsUpdate = true;
}

function getVelocityAtPosition(x, y, z, sliceIdx) {
  if (sliceIdx < 0 || sliceIdx >= velocityData.numSlices) return 0;
  
  const velGrid = velocityData.slices[sliceIdx];
  const maskGrid = velocityData.masks[sliceIdx];
  
  if (!velGrid.length || !maskGrid.length) return 0;
  
  const rows = velGrid.length;
  const cols = velGrid[0].length;
  
  // Convert world position to grid coordinates - match cross-section coordinate system
  const sliceX = (sliceIdx - velocityData.numSlices / 2) * velocityData.sliceSpacing;
  // Match cross-section: yFrac = (rows - 1 - r) / (rows - 1), so reverse it
  const yFrac = (y - (velocityData.sliceCenterY - velocityData.sliceHeight / 2)) / velocityData.sliceHeight;
  const r = Math.floor((1 - yFrac) * (rows - 1)); // Reverse the Y mapping
  // Match cross-section: Z is negated, so reverse it
  // Use the actual width for this slice
  const sliceWidth = velocityData.sliceWidths[sliceIdx] || velocityData.sliceWidths[0];
  const zFrac = (-z + sliceWidth / 2) / sliceWidth;
  const c = Math.floor(zFrac * (cols - 1));
  
  const rClamped = Math.max(0, Math.min(rows - 1, r));
  const cClamped = Math.max(0, Math.min(cols - 1, c));
  
  if (maskGrid[rClamped] && maskGrid[rClamped][cClamped] > 0.5) {
    return velGrid[rClamped][cClamped] || 0;
  }
  
  return 0;
}

