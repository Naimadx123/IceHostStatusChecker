export type CheckerRow = {
    id: number;
    guild_id: string;
    channel_id: string;
    support_id: string;
    api_key_enc: string;
    interval_minutes: number;
    last_state: string | null;
    last_uptime_ms: number | null;
};

export type PteroResourceResponse = {
    object: 'stats';
    attributes: {
        current_state: string;
        is_suspended: boolean;
        resources: {
            memory_bytes: number;
            cpu_absolute: number;
            disk_bytes: number;
            network_rx_bytes: number;
            network_tx_bytes: number;
            uptime: number;
        };
    };
};

export type PteroServerDetailsResponse = {
    object: 'server';
    attributes: {
        identifier: string;
        name: string;
    };
};