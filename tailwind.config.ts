import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
        brand: {
          primary: 'var(--brand-primary)',
          hover: 'var(--brand-primary-hover)',
          bg: 'var(--brand-bg)',
          light: 'var(--brand-light)',
        },
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
			// -- Calm Mint palette - used by app/activity-planner ----------------
			mint: {
				DEFAULT: '#0D9669',
				600: '#0B7F5A',
				700: '#096B4C',
				soft: '#E6F4EE',
				gradient: '#E8F6EF',
				bg: '#F7FCF9',
				card: '#FFFFFF',
				border: '#E2ECE8',
			},
			ink: { DEFAULT: '#0F172A', muted: '#64748B' },
			clay: { DEFAULT: '#D4724A', 700: '#B45C38', soft: '#FFF1E6' },
			alert: { DEFAULT: '#DC2626', soft: '#FDE8E8' },
			info: { DEFAULT: '#2563EB', soft: '#E8F0FD' },
			hint: { bg: '#FEF3C7', text: '#92400E' },
		},
		// -- Nunito: rounded, friendly, high-legibility (Calm Mint system) ------
		fontFamily: {
			nunito: ['var(--font-nunito)', 'Nunito', 'ui-rounded', 'system-ui', 'sans-serif'],
		},
		boxShadow: {
			mint: '0 6px 16px rgba(13,150,105,.3)',
			'mint-lg': '0 12px 30px rgba(13,150,105,.22)',
			card: '0 2px 10px rgba(13,150,105,.06)',
			'card-lg': '0 10px 30px rgba(15,23,42,.08)',
			sheet: '0 -12px 40px rgba(15,23,42,.16)',
		},
  		animation: {
  			bellShake: 'bellShake 0.5s ease-in-out infinite',
			'sheet-up': 'sheetUp .32s cubic-bezier(.22,1,.36,1)',
			'fade-rise': 'fadeRise .28s cubic-bezier(.22,1,.36,1)',
			'pulse-soft': 'pulseSoft 2s ease-in-out infinite'
  		},
  		keyframes: {
  			bellShake: {
  				'0%': {
  					transform: 'translateX(0)'
  				},
  				'25%': {
  					transform: 'translateX(-5px)'
  				},
  				'50%': {
  					transform: 'translateX(5px)'
  				},
  				'75%': {
  					transform: 'translateX(-5px)'
  				},
  				'100%': {
  					transform: 'translateX(0)'
  				}
  			},
			sheetUp: {
				'0%': { transform: 'translateY(100%)' },
				'100%': { transform: 'translateY(0)' },
			},
			fadeRise: {
				'0%': { opacity: '0', transform: 'translateY(8px)' },
				'100%': { opacity: '1', transform: 'translateY(0)' },
			},
			pulseSoft: {
				'0%, 100%': { opacity: '1' },
				'50%': { opacity: '.45' },
			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [typography, require("tailwindcss-animate")],
};

export default config;
