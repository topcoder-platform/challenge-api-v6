
function parseStringArray(stringArray, modelName="") {
    // If stringArray is undefined or null, return empty array
    if (!stringArray) {
        return [];
    }

    // If stringArray is already an array, return it
    if (Array.isArray(stringArray)) {
        return stringArray;
    }

    // If stringArray is a string, try to parse it as JSON
    if (typeof stringArray === 'string') {
        try {
            return JSON.parse(stringArray);
        } catch (error) {
            console.error(`Error parsing ${modelName} JSON string:`, error);
            return [];
        }
    }

    // If it's some other type, return empty array
    return [];
}

module.exports = {
    parseStringArray
}