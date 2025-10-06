# Use the base image with Node.js
FROM node:22.19-alpine
RUN apk add --update --no-cache openssh-client git
# Copy the current directory into the Docker image
COPY . /challenge-api

# Set working directory for future use
WORKDIR /challenge-api

# Install the dependencies from package.json
RUN npm i -g pnpm
RUN pnpm install

CMD node /challenge-api/app.js
