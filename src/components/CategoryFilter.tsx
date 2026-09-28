import React, { useRef, useEffect, useState } from 'react';
import { CATEGORIES } from '../data/packs';

interface CategoryFilterProps {
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  selectedCategory,
  onSelectCategory,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isMouseDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const [isGrabbing, setIsGrabbing] = useState(false);

  // Repeat categories 3 times to create a completely seamless infinite loop
  const triplicatedCategories = [
    ...CATEGORIES.map((c, i) => ({ name: c, key: `set1-${c}-${i}` })),
    ...CATEGORIES.map((c, i) => ({ name: c, key: `set2-${c}-${i}` })),
    ...CATEGORIES.map((c, i) => ({ name: c, key: `set3-${c}-${i}` })),
  ];

  // Auto-scroll continuously (never pauses on simple hover)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Start centered in the middle set
    if (container.scrollWidth > 0 && container.scrollLeft === 0) {
      container.scrollLeft = container.scrollWidth / 3;
    }

    let animId: number;
    let lastTime = performance.now();
    const speed = 36; // Constant smooth continuous scroll speed (pixels/sec)

    const step = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      // Only pause auto-scroll when user is actively clicking & dragging with mouse/finger
      if (!isMouseDownRef.current && container) {
        container.scrollLeft += speed * delta;

        const oneThird = container.scrollWidth / 3;
        if (oneThird > 0) {
          if (container.scrollLeft >= oneThird * 2) {
            container.scrollLeft -= oneThird;
          } else if (container.scrollLeft <= 5) {
            container.scrollLeft += oneThird;
          }
        }
      }

      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);

    // Global mouseup listener so dragging releases smoothly even if cursor leaves window
    const handleGlobalMouseUp = () => {
      if (isMouseDownRef.current) {
        isMouseDownRef.current = false;
        setIsGrabbing(false);
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 50);
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // Mouse Drag to Scroll handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isMouseDownRef.current = true;
    isDraggingRef.current = false;
    startXRef.current = e.pageX;
    if (scrollContainerRef.current) {
      startScrollLeftRef.current = scrollContainerRef.current.scrollLeft;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current || !scrollContainerRef.current) return;

    const dx = e.pageX - startXRef.current;
    if (Math.abs(dx) > 4) {
      isDraggingRef.current = true;
      setIsGrabbing(true);
    }

    if (isDraggingRef.current) {
      const container = scrollContainerRef.current;
      container.scrollLeft = startScrollLeftRef.current - dx;

      // Wrap around while dragging if needed
      const oneThird = container.scrollWidth / 3;
      if (oneThird > 0) {
        if (container.scrollLeft >= oneThird * 2) {
          container.scrollLeft -= oneThird;
          startScrollLeftRef.current -= oneThird;
        } else if (container.scrollLeft <= 5) {
          container.scrollLeft += oneThird;
          startScrollLeftRef.current += oneThird;
        }
      }
    }
  };

  const handleMouseUp = () => {
    isMouseDownRef.current = false;
    setIsGrabbing(false);
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  };

  // Touch Drag Handlers (Mobile)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    isMouseDownRef.current = true;
    isDraggingRef.current = false;
    startXRef.current = e.touches[0].pageX;
    if (scrollContainerRef.current) {
      startScrollLeftRef.current = scrollContainerRef.current.scrollLeft;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current || !scrollContainerRef.current) return;
    const dx = e.touches[0].pageX - startXRef.current;
    if (Math.abs(dx) > 4) {
      isDraggingRef.current = true;
    }
    if (isDraggingRef.current) {
      const container = scrollContainerRef.current;
      container.scrollLeft = startScrollLeftRef.current - dx;
      const oneThird = container.scrollWidth / 3;
      if (oneThird > 0) {
        if (container.scrollLeft >= oneThird * 2) {
          container.scrollLeft -= oneThird;
          startScrollLeftRef.current -= oneThird;
        } else if (container.scrollLeft <= 5) {
          container.scrollLeft += oneThird;
          startScrollLeftRef.current += oneThird;
        }
      }
    }
  };

  const handleTouchEnd = () => {
    isMouseDownRef.current = false;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  };

  // Wheel horizontal scroll
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollContainerRef.current) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      scrollContainerRef.current.scrollLeft += delta;
    }
  };

  const handleCategoryClick = (catUpper: string) => {
    if (isDraggingRef.current) return; // Ignore clicks if user was dragging
    onSelectCategory(catUpper);
  };

  return (
    <div className="w-full my-5 relative px-1 sm:px-4 overflow-hidden">
      {/* Subtle edge fades */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 sm:w-12 bg-gradient-to-r from-[#0b0c0e] to-transparent z-10" />
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 sm:w-12 bg-gradient-to-l from-[#0b0c0e] to-transparent z-10" />

      {/* Smooth Continuous Scrolling & Drag-to-Scroll Container */}
      <div
        ref={scrollContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        className={`flex items-center gap-2 sm:gap-2.5 overflow-x-auto scrollbar-none py-1.5 px-6 max-w-full select-none ${
          isGrabbing ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {triplicatedCategories.map(({ name, key }) => {
          const catUpper = name.toUpperCase();
          const isActive =
            selectedCategory.toUpperCase() === catUpper ||
            (catUpper === 'TODOS' &&
              (selectedCategory.toUpperCase() === 'TODOS' || selectedCategory === 'Todos'));

          return (
            <button
              key={key}
              type="button"
              onClick={() => handleCategoryClick(catUpper)}
              className={`whitespace-nowrap text-xs sm:text-sm px-4 sm:px-5 py-2 rounded-full transition-colors duration-150 shrink-0 font-extrabold uppercase tracking-wide border cursor-pointer ${
                isActive
                  ? 'bg-[#ea8c00] text-white border-[#ea8c00] shadow-md shadow-amber-500/25'
                  : 'bg-black text-white border-neutral-700 hover:border-neutral-400 hover:bg-neutral-900'
              }`}
              style={{
                // Explicitly preserve exact dimensions to avoid any resize or jitter
                boxSizing: 'border-box',
                transform: 'none',
              }}
            >
              {catUpper}
            </button>
          );
        })}
      </div>
    </div>
  );
};
