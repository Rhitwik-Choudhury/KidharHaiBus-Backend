const PLACES_BASE_URL = "https://places.googleapis.com/v1";

const getApiKey = () => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    const error = new Error("Location search is not configured");
    error.statusCode = 503;
    throw error;
  }

  return apiKey;
};

const readGoogleError = async (response) => {
  try {
    const payload = await response.json();
    return payload?.error?.message || "Google Places request failed";
  } catch {
    return "Google Places request failed";
  }
};

exports.autocompletePlaces = async (req, res) => {
  try {
    const input = String(req.body?.input || "").trim();
    const sessionToken = String(req.body?.sessionToken || "").trim();

    if (input.length < 3 || input.length > 160) {
      return res.status(400).json({
        message: "Enter at least 3 characters to search",
      });
    }

    if (!sessionToken || sessionToken.length > 128) {
      return res.status(400).json({ message: "Invalid search session" });
    }

    const requestBody = {
      input,
      sessionToken,
      includedRegionCodes: ["in"],
      languageCode: "en",
    };

    const latitude = Number(req.body?.locationBias?.latitude);
    const longitude = Number(req.body?.locationBias?.longitude);

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      requestBody.locationBias = {
        circle: {
          center: { latitude, longitude },
          radius: 50000,
        },
      };
    }

    const response = await fetch(`${PLACES_BASE_URL}/places:autocomplete`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": getApiKey(),
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const message = await readGoogleError(response);
      console.error("Places autocomplete failed:", response.status, message);
      return res.status(502).json({ message: "Location search is temporarily unavailable" });
    }

    const data = await response.json();
    const suggestions = (data.suggestions || [])
      .map(({ placePrediction }) => {
        if (!placePrediction?.placeId) return null;

        const fullText = placePrediction.text?.text || "";
        const mainText =
          placePrediction.structuredFormat?.mainText?.text || fullText;
        const secondaryText =
          placePrediction.structuredFormat?.secondaryText?.text || "";

        return {
          placeId: placePrediction.placeId,
          mainText,
          secondaryText,
          fullText,
        };
      })
      .filter(Boolean)
      .slice(0, 5);

    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error("Places autocomplete error:", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode
        ? error.message
        : "Unable to search locations right now",
    });
  }
};

exports.getPlaceDetails = async (req, res) => {
  try {
    const placeId = String(req.params?.placeId || "").trim();
    const sessionToken = String(req.query?.sessionToken || "").trim();

    if (!placeId || placeId.length > 300 || !sessionToken || sessionToken.length > 128) {
      return res.status(400).json({ message: "Invalid place selection" });
    }

    const query = new URLSearchParams({
      languageCode: "en",
      regionCode: "IN",
      sessionToken,
    });

    const response = await fetch(
      `${PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}?${query.toString()}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          "X-Goog-Api-Key": getApiKey(),
          "X-Goog-FieldMask": "id,formattedAddress,location",
        },
      }
    );

    if (!response.ok) {
      const message = await readGoogleError(response);
      console.error("Place details failed:", response.status, message);
      return res.status(502).json({ message: "Unable to open this location" });
    }

    const place = await response.json();
    if (
      !Number.isFinite(place.location?.latitude) ||
      !Number.isFinite(place.location?.longitude)
    ) {
      return res.status(502).json({ message: "This location has no map coordinates" });
    }

    return res.status(200).json({
      placeId: place.id,
      formattedAddress: place.formattedAddress || "",
      location: place.location,
    });
  } catch (error) {
    console.error("Place details error:", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to open this location",
    });
  }
};
