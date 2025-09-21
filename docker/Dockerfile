# Use the base image with Node.js
FROM node:22.19-alpine
RUN apk add --update --no-cache openssh-client git
RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
# Copy the current directory into the Docker image
COPY . /challenge-api

# Set working directory for future use
WORKDIR /challenge-api

# Install the dependencies from package.json
RUN npm i -g pnpm
RUN --mount=type=ssh pnpm install

CMD node /challenge-api/app.js
