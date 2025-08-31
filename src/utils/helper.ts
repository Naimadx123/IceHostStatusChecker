import {config} from "../config";

export function isOwner(userId: string) {
    return config.botOwnerIds.includes(userId);
}