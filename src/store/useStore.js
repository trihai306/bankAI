import { create } from 'zustand'

const useStore = create((set, get) => ({
    stats: {
        totalCalls: 0,
        todayCalls: 0,
        successRate: 0,
        avgDuration: '0:00'
    },
    recentCalls: [],
    settings: {},
    isLoading: false,
    isElectron: false,

    fetchDashboardData: async () => {
        set({ isLoading: true })
        try {
            if (window.electronAPI?.db) {
                set({ isElectron: true })
                const [stats, recentCalls] = await Promise.all([
                    window.electronAPI.db.getStats(),
                    window.electronAPI.db.getRecentCalls()
                ])
                set({ stats, recentCalls })
            } else {
                // Browser mode - show empty state (no mock data)
                console.warn('Electron API not found, showing empty state')
                set({
                    isElectron: false,
                    stats: {
                        totalCalls: 0,
                        todayCalls: 0,
                        successRate: 0,
                        avgDuration: '0:00'
                    },
                    recentCalls: []
                })
            }
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error)
        } finally {
            set({ isLoading: false })
        }
    },

    fetchSettings: async () => {
        try {
            if (window.electronAPI?.db) {
                const settings = await window.electronAPI.db.getSettings()
                set({ settings })
            }
        } catch (error) {
            console.error('Failed to fetch settings:', error)
        }
    }
}))

export default useStore
